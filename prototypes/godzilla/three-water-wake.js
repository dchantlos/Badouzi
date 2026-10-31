import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode.js";
import { renderCoordinateTransformAt } from "@arcgis/core/views/3d/webgl.js";
import {
  Camera, FrontSide, GLSL3, Matrix3, Matrix4, Mesh, NoBlending, PlaneGeometry,
  RawShaderMaterial, Scene, Vector2, Vector3
} from "three";
import { END, WATER_Z, sampleReveal } from "./timeline.js";
import { WAKE_GRID } from "./wake-field.js";
import { createWakeForcing } from "./wake-forcing.js";
import { createThreeRenderBridge } from "./three-render-bridge.js";
import { createWakeUniformData, wakeVertexShader, wakeFragmentShader, writeWakeUniformData } from "./wake-shader.js";

export async function createThreeWaterWake(view, { onError } = {}) {
  const forcing = createWakeForcing();
  const data = createWakeUniformData();
  const scene = new Scene();
  const camera = new Camera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const { minX, maxX, minY, maxY } = WAKE_GRID;
  const geometry = new PlaneGeometry(maxX - minX, maxY - minY,
    Math.round((maxX - minX) / 2), Math.round((maxY - minY) / 2));
  geometry.translate((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const uniforms = {
    uTime: { value: 0 },
    uSource: { value: data.source },
    uSourcePower: { value: 0 },
    uHasSource: { value: false },
    uPacketCount: { value: 0 },
    uPacketA: { value: data.a }, uPacketB: { value: data.b },
    uPacketC: { value: data.c }, uPacketD: { value: data.d },
    uSceneColor: { value: null }, uSceneDepth: { value: null },
    uResolution: { value: new Vector2() },
    uProjectionScale: { value: new Vector2() },
    uInverseProjection: { value: new Matrix4() },
    uViewToLocal: { value: new Matrix4() },
    uLocalNormalToView: { value: new Matrix3() },
    uFlatNormalView: { value: new Vector3() },
    uSunDirectionView: { value: new Vector3() },
    uSunDiffuse: { value: new Vector3() },
    uSunAmbient: { value: new Vector3() }
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3, uniforms,
    vertexShader: wakeVertexShader, fragmentShader: wakeFragmentShader,
    side: FrontSide, depthTest: false, depthWrite: false, blending: NoBlending,
    toneMapped: false
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const localToRender = new Matrix4();
  const rotation = new Matrix4().makeRotationZ(-sampleReveal(0).heading * Math.PI / 180);
  const nativeView = new Matrix4();
  let bridge;
  let node;
  let enabled = false;
  let disposed = false;
  let failed = false;
  let ready = false;
  let lastFrame = -1;
  let simulationTime = 0;
  let updatedAt = 0;
  let renderedFrames = 0;
  let resolveReady, rejectReady;
  const prepared = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timeout = setTimeout(() => fail(new Error("Three.js water shader preparation timed out")), 30000);

  function fail(error) {
    if (failed || disposed) return;
    failed = true;
    clearTimeout(timeout);
    if (!ready) rejectReady(error);
    else queueMicrotask(() => {
      if (disposed) return;
      if (onError) onError(error);
      else console.warn("[Badouzi Digital Twin] Three.js water shader:", error);
    });
  }
  function syncFrame(renderNode, textures) {
    const renderCamera = renderNode.camera;
    const transform = renderCoordinateTransformAt(view, [END.x, END.y, WATER_Z], view.spatialReference);
    if (!transform) throw new Error("Cannot place the Three.js water in the scene coordinate system");
    localToRender.fromArray(transform).multiply(rotation);
    nativeView.fromArray(renderCamera.viewMatrix);
    camera.matrixWorldInverse.copy(nativeView).multiply(localToRender);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    camera.projectionMatrix.fromArray(renderCamera.projectionMatrix);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.uViewToLocal.value.copy(camera.matrixWorld);
    uniforms.uLocalNormalToView.value.getNormalMatrix(camera.matrixWorldInverse);
    uniforms.uFlatNormalView.value.set(0, 0, 1).applyMatrix3(uniforms.uLocalNormalToView.value).normalize();
    uniforms.uSceneColor.value = textures.color;
    uniforms.uSceneDepth.value = textures.depth;
    uniforms.uResolution.value.set(textures.width, textures.height);
    uniforms.uProjectionScale.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
    uniforms.uTime.value = simulationTime + (enabled && updatedAt ? (performance.now() - updatedAt) / 1000 : 0);
    const sun = renderNode.sunLight;
    uniforms.uSunDirectionView.value.fromArray(sun.direction).transformDirection(nativeView);
    uniforms.uSunDiffuse.value.fromArray(sun.diffuse.color).multiplyScalar(sun.diffuse.intensity);
    uniforms.uSunAmbient.value.fromArray(sun.ambient.color).multiplyScalar(sun.ambient.intensity);
  }
  const WaterNode = RenderNode.createSubclass({
    consumes: { required: ["final-color"] },
    produces: "final-color",
    render() {
      if (disposed || failed || (ready && (!enabled || !forcing.active))) return this.bindRenderTarget();
      try {
        this.resetWebGLState();
        bridge ??= createThreeRenderBridge(this.gl);
        const result = bridge.draw(this, scene, camera, textures => syncFrame(this, textures));
        if (result.error) {
          fail(result.error);
          return result.output;
        }
        renderedFrames++;
        if (!ready) {
          ready = true;
          clearTimeout(timeout);
          resolveReady();
        }
        if (enabled && forcing.active) this.requestRender();
        return result.output;
      } catch (error) {
        fail(error);
        this.resetWebGLState();
        return this.bindRenderTarget();
      }
    }
  });
  node = new WaterNode({ view });
  function reset() {
    forcing.reset();
    lastFrame = -1;
    simulationTime = 0;
    updatedAt = 0;
    writeWakeUniformData(data, forcing.snapshot());
    uniforms.uSourcePower.value = 0;
    uniforms.uHasSource.value = false;
    uniforms.uPacketCount.value = 0;
    if (!disposed) node.requestRender();
  }
  const backend = {
    get readyToDraw() { return ready && !failed && !disposed; },
    get stats() {
      return {
        ready, failed, disposed, enabled, active: forcing.active, renderedFrames,
        vertices: geometry.attributes.position.count, ...bridge?.stats
      };
    },
    reset,
    update(state, seconds, getContact) {
      if (!enabled || disposed || failed) return;
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid shader wake clock");
      simulationTime = seconds;
      updatedAt = performance.now();
      const frame = Math.floor(seconds * 15);
      if (frame !== lastFrame) {
        lastFrame = frame;
        forcing.update(state, seconds, getContact);
        writeWakeUniformData(data, forcing.snapshot());
        uniforms.uSourcePower.value = data.power;
        uniforms.uHasSource.value = data.hasSource;
        uniforms.uPacketCount.value = data.count;
      }
      if (forcing.active) node.requestRender();
    },
    setVisible(value) {
      enabled = value;
      if (!disposed) node.requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      clearTimeout(timeout);
      node.destroy();
      geometry.dispose();
      material.dispose();
      bridge?.dispose();
    }
  };
  node.requestRender();
  try {
    await prepared;
  } catch (error) {
    backend.dispose();
    throw error;
  }
  return backend;
}
