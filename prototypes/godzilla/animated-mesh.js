import Mesh from "@arcgis/core/geometry/Mesh.js";
import Point from "@arcgis/core/geometry/Point.js";
import Graphic from "@arcgis/core/Graphic.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import MeshMaterialMetallicRoughness from "@arcgis/core/geometry/support/MeshMaterialMetallicRoughness.js";
import MeshTexture from "@arcgis/core/geometry/support/MeshTexture.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createArmMotion } from "./arm-motion.js";
import { HEAD_BONES, createHeadMotion, sampleHeadMotion } from "./head-motion.js";
import { waterContactBounds } from "./water-contact.js";
import { DORSAL_REGIONS, dorsalEmission, partitionDorsalPlates } from "./dorsal-plates.js";
import { HEIGHT_M, WALK_CYCLES, WATER_Z, sampleArmMotion, sampleReveal } from "./timeline.js";

async function neutralEmissionTexture(texture) {
  if (!texture) throw new Error("Godzilla's dorsal texture is missing");
  let source = texture.data;
  if (!source && texture.url) {
    source = new Image();
    source.crossOrigin = "anonymous";
    source.src = texture.url;
    await source.decode();
  }
  if (source instanceof HTMLImageElement) await source.decode();
  if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement || source instanceof ImageData)) {
    throw new Error("Godzilla's dorsal texture cannot be converted to an emissive mask");
  }
  const canvas = document.createElement("canvas");
  canvas.width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  canvas.height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) throw new Error("Godzilla's emissive texture could not be prepared");
  if (source instanceof ImageData) context.putImageData(source, 0, 0);
  else context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  // Keep the plate detail, but do not let the brown diffuse atlas turn cyan
  // emission green. This copy never changes the original skin texture.
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = Math.round(image.data[index] * 0.2126 +
      image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722);
    image.data[index] = image.data[index + 1] = image.data[index + 2] = luminance;
    image.data[index + 3] = 255;
  }
  return new MeshTexture({ data: image, transparent: false, wrap: texture.wrap });
}

async function addDorsalEmission(mesh) {
  const bodies = mesh.components.filter(component => component.name === "Object_0");
  if (bodies.length !== 1 || !(bodies[0].material instanceof MeshMaterialMetallicRoughness)) {
    throw new Error("The expected Godzilla body material is missing");
  }
  const body = bodies[0];
  const { groups, selectedIslands } = partitionDorsalPlates(mesh.vertexAttributes.position, body.faces);
  if (selectedIslands !== 31) throw new Error(`Unexpected dorsal topology: ${selectedIslands} islands`);
  const skin = body.clone();
  skin.faces = groups.body;
  skin.material = body.material;
  const emissionTexture = await neutralEmissionTexture(body.material.colorTexture);
  const materials = {};
  const previous = {};
  const plates = DORSAL_REGIONS.map(region => {
    const component = body.clone();
    component.name = `Godzilla dorsal ${region}`;
    component.faces = groups[region];
    const material = body.material.clone();
    material.emissiveColor = [0, 0, 0];
    material.emissiveTexture = emissionTexture;
    material.emissiveTextureTransform = body.material.colorTextureTransform;
    material.emissiveStrength = 0;
    component.material = material;
    materials[region] = material;
    previous[region] = 0;
    return component;
  });
  mesh.components = mesh.components.flatMap(component => component === body ? [skin, ...plates] : [component]);
  return glow => {
    for (const region of DORSAL_REGIONS) {
      const progress = glow[region];
      if (progress === previous[region]) continue;
      const emission = dorsalEmission(progress);
      // Keep uncharged regions black as well as zero-strength, so no blue
      // tint is present before their turn or after replay.
      if (progress === 0 || previous[region] === 0) materials[region].emissiveColor = emission.color;
      materials[region].emissiveStrength = emission.strength;
      previous[region] = progress;
    }
  };
}

export async function createAnimatedMonster(view, { walking }) {
  const url = new URL("./godzilla-walk.glb", import.meta.url).href;
  const initial = sampleReveal(0);
  const origin = new Point({ x: initial.x, y: initial.y, z: WATER_Z, spatialReference: view.spatialReference });
  const [gltf, mesh] = await Promise.all([
    new GLTFLoader().loadAsync(url),
    Mesh.createFromGLTF(origin, url)
  ]);
  if (mesh.vertexSpace.type !== "local") throw new Error("The walking mesh must use local metre-based coordinates");
  const clip = gltf.animations.find(animation => animation.name === "Slow_Wade_6_4s");
  if (!clip) throw new Error("The walking GLB is missing its baked animation");
  let metadata;
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if (Number.isFinite(object.userData.source_height)) metadata = object.userData;
    if (object.isSkinnedMesh) parts.push(object);
  });
  if (!metadata || !parts.length) throw new Error("The walking model has no rig or scale metadata");
  const count = parts.reduce((total, object) => total + object.geometry.attributes.position.count, 0);
  const positions = mesh.vertexAttributes.position;
  const normals = mesh.vertexAttributes.normal;
  const tangents = mesh.vertexAttributes.tangent;
  if (positions.length !== count * 3 || !normals) throw new Error("ArcGIS and animated mesh vertex counts do not match");
  const vertex = new THREE.Vector3();
  let offset = 0;
  let maxMappingError = 0;
  for (const object of parts) {
    const attribute = object.geometry.attributes.position;
    for (let index = 0; index < attribute.count; index++, offset++) {
      vertex.fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
      maxMappingError = Math.max(maxMappingError,
        Math.abs(positions[offset * 3] - vertex.x),
        Math.abs(positions[offset * 3 + 1] + vertex.z),
        Math.abs(positions[offset * 3 + 2] - vertex.y));
    }
  }
  if (maxMappingError > 0.001) throw new Error(`Animated vertex mapping differs by ${maxMappingError} metres`);
  const updateDorsalEmission = await addDorsalEmission(mesh);
  const scale = HEIGHT_M / metadata.source_height;
  const sourceMinZ = Math.min(...positions.filter((_, index) => index % 3 === 2));
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const armMotion = createArmMotion(gltf.scene);
  const headMotion = createHeadMotion(gltf.scene);
  const headBones = new Set();
  gltf.scene.getObjectByName(HEAD_BONES.neckBase).traverse(object => {
    if (object.isBone) headBones.add(object);
  });
  const layer = new GraphicsLayer({
    title: "Godzilla (fictional effect)",
    visible: false,
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });
  const graphic = new Graphic({
    geometry: mesh,
    symbol: { type: "mesh-3d", symbolLayers: [{ type: "fill" }] }
  });
  layer.add(graphic);
  view.map.add(layer);
  const baseNormal = new THREE.Vector3();
  const transformed = new THREE.Vector3();
  const accumulated = new THREE.Vector3();
  const skinIndices = new THREE.Vector4();
  const skinWeights = new THREE.Vector4();
  const boneMatrix = new THREE.Matrix4();
  let vertexOffset = 0;
  const resources = parts.map(object => {
    const { attributes } = object.geometry;
    const headVertices = [];
    for (let index = 0; index < attributes.position.count; index++) {
      skinIndices.fromBufferAttribute(attributes.skinIndex, index);
      skinWeights.fromBufferAttribute(attributes.skinWeight, index);
      for (let component = 0; component < 4; component++) {
        if (skinWeights.getComponent(component) > 0 &&
          headBones.has(object.skeleton.bones[skinIndices.getComponent(component)])) {
          headVertices.push(index);
          break;
        }
      }
    }
    const resource = {
      object, headVertices, vertexOffset,
      boneNormals: object.skeleton.bones.map(() => new THREE.Matrix3()),
      bindNormal: new THREE.Matrix3().getNormalMatrix(object.bindMatrix),
      bindInverseNormal: new THREE.Matrix3().getNormalMatrix(object.bindMatrixInverse),
      worldNormal: new THREE.Matrix3().getNormalMatrix(object.matrixWorld)
    };
    vertexOffset += attributes.position.count;
    return resource;
  });
  let lastPose = -1;
  let lastRise = -1;
  let lastArmFrame = -1;
  let lastHeadTime = -1;
  let lastPlacement;
  const totalPoseFrames = Math.round(clip.duration * WALK_CYCLES * 30);

  function deform(time, armState, headPose, headOnly) {
    armMotion.restore();
    headMotion.restore();
    mixer.setTime(time);
    armMotion.apply(sampleArmMotion(armState));
    headMotion.apply(headPose);
    gltf.scene.updateMatrixWorld(true);
    for (const { object, headVertices, vertexOffset, boneNormals, bindNormal, bindInverseNormal, worldNormal } of resources) {
      if (headOnly && !headVertices.length) continue;
      const { skeleton, geometry } = object;
      skeleton.update();
      for (let index = 0; index < boneNormals.length; index++) {
        boneMatrix.fromArray(skeleton.boneMatrices, index * 16);
        boneNormals[index].getNormalMatrix(boneMatrix);
      }
      const attributes = geometry.attributes;
      const count = headOnly ? headVertices.length : attributes.position.count;
      for (let cursor = 0; cursor < count; cursor++) {
        const index = headOnly ? headVertices[cursor] : cursor;
        const destination = vertexOffset + index;
        object.getVertexPosition(index, vertex).applyMatrix4(object.matrixWorld);
        positions[destination * 3] = vertex.x;
        positions[destination * 3 + 1] = -vertex.z;
        positions[destination * 3 + 2] = vertex.y;
        skinIndices.fromBufferAttribute(attributes.skinIndex, index);
        skinWeights.fromBufferAttribute(attributes.skinWeight, index);
        for (let attributeIndex = 0; attributeIndex < 2; attributeIndex++) {
          const source = attributeIndex === 0 ? attributes.normal : attributes.tangent;
          const target = attributeIndex === 0 ? normals : tangents;
          const stride = attributeIndex === 0 ? 3 : 4;
          if (!source || !target) continue;
          baseNormal.fromBufferAttribute(source, index).applyMatrix3(bindNormal);
          accumulated.set(0, 0, 0);
          for (let component = 0; component < 4; component++) {
            const weight = skinWeights.getComponent(component);
            if (!weight) continue;
            transformed.copy(baseNormal).applyMatrix3(boneNormals[skinIndices.getComponent(component)]);
            accumulated.addScaledVector(transformed, weight);
          }
          accumulated.applyMatrix3(bindInverseNormal).applyMatrix3(worldNormal).normalize();
          target[destination * stride] = accumulated.x;
          target[destination * stride + 1] = -accumulated.z;
          target[destination * stride + 2] = accumulated.y;
          if (stride === 4) target[destination * stride + 3] = source.getW(index);
        }
      }
    }
    mesh.vertexAttributesChanged();
  }
  let layerView;
  const backend = {
    get readyToDraw() {
      return layerView !== undefined && !layerView.updating && !layerView.suspended;
    },
    getWaterContact() {
      const body = mesh.components.find(component => component.name === "Object_0");
      if (!body?.faces) throw new Error("Godzilla's water-contact surface is missing");
      return waterContactBounds(positions, body.faces, -mesh.transform.translation[2] / scale, scale);
    },
    update(state, seconds = 0) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Godzilla's motion clock must be nonnegative and finite");
      const armFrame = Math.round(state.approach * totalPoseFrames);
      const pose = walking ? armFrame / 30 : 0;
      const rise = Math.round(state.rise * 256) / 256;
      const headRate = state.done ? 15 : 30;
      const headTime = rise > 0.15 ? Math.round(seconds * headRate) / headRate : 0;
      const bodyChanged = pose !== lastPose || rise !== lastRise || armFrame !== lastArmFrame;
      if (bodyChanged || headTime !== lastHeadTime) {
        const armState = { rise, approach: armFrame / totalPoseFrames };
        deform(pose, armState, sampleHeadMotion({ ...armState, seconds: headTime }), !bodyChanged);
        lastPose = pose;
        lastRise = rise;
        lastArmFrame = armFrame;
        lastHeadTime = headTime;
      }
      const placement = [state.x, state.y, state.heading, state.anchorZ];
      if (!lastPlacement || placement.some((value, index) => value !== lastPlacement[index])) {
        mesh.vertexSpace.origin = [state.x, state.y, WATER_Z];
        mesh.transform = {
          scale: [scale, scale, scale],
          rotationAxis: [0, 0, 1],
          rotationAngle: -state.heading,
          translation: [0, 0, -HEIGHT_M * (state.anchorZ + 0.5) - sourceMinZ * scale]
        };
        lastPlacement = placement;
      }
      updateDorsalEmission(state.glow);
    },
    setVisible(visible) {
      layer.visible = visible;
    },
    setWalking(enabled) {
      walking = enabled;
      lastPose = -1;
    },
    dispose() {
      view.map.remove(layer);
      layer.destroy();
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      const materials = new Set();
      const textures = new Set();
      for (const object of parts) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      }
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
    }
  };
  backend.update(initial);
  try {
    layerView = await view.whenLayerView(layer);
  } catch (error) {
    backend.dispose();
    throw error;
  }
  return backend;
}
