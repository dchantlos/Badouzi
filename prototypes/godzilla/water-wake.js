import Mesh from "@arcgis/core/geometry/Mesh.js";
import Graphic from "@arcgis/core/Graphic.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import MeshMaterialMetallicRoughness from "@arcgis/core/geometry/support/MeshMaterialMetallicRoughness.js";
import MeshTexture from "@arcgis/core/geometry/support/MeshTexture.js";
import { PlaneGeometry } from "three";
import { DURATION_S, END, HEIGHT_M, WATER_Z, sampleReveal } from "./timeline.js";
import { WAKE_GRID, createWakeField, wakeCoordinates } from "./wake-field.js";

function foamTexture() {
  const size = 256;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const mix = (a, b, t) => a + (b - a) * t;
  function noise(x, y, step, seed) {
    const period = size / step;
    const ix = Math.floor(x / step), iy = Math.floor(y / step);
    const fx = x / step - ix, fy = y / step - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    function hash(a, b) {
      let value = Math.imul(a % period + seed, 374761393) ^ Math.imul(b % period + seed, 668265263);
      value = Math.imul(value ^ value >>> 13, 1274126177);
      return ((value ^ value >>> 16) >>> 0) / 4294967295;
    }
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), sx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.max(0, Math.min(1, (noise(x, y, 32, 7) * 0.55 +
        noise(x, y, 8, 19) * 0.3 + noise(x, y, 2, 37) * 0.15 - 0.22) * 1.8));
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
      pixels[index + 3] = Math.round(255 * value);
    }
  }
  return new MeshTexture({ data: new ImageData(pixels, size, size), transparent: true, wrap: "repeat" });
}

export async function createWaterWake(view) {
  const { minX, maxX, minY, maxY, spacing } = WAKE_GRID;
  const geometry = new PlaneGeometry(maxX - minX, maxY - minY,
    Math.round((maxX - minX) / spacing), Math.round((maxY - minY) / spacing));
  geometry.translate((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const vertices = geometry.attributes.position;
  const positions = new Float64Array(vertices.array);
  const normals = new Float32Array(geometry.attributes.normal.array);
  const colors = new Uint8Array(vertices.count * 4);
  const uv = new Float32Array(vertices.count * 2);
  for (let index = 0; index < vertices.count; index++) {
    uv[index * 2] = positions[index * 3] / 48;
    uv[index * 2 + 1] = positions[index * 3 + 1] / 48;
    colors[index * 4] = 220;
    colors[index * 4 + 1] = 232;
    colors[index * 4 + 2] = 236;
  }
  const mesh = new Mesh({
    spatialReference: view.spatialReference,
    vertexSpace: { type: "local", origin: [END.x, END.y, WATER_Z] },
    vertexAttributes: { position: positions, normal: normals, color: colors, uv },
    components: [{
      faces: new Uint32Array(geometry.index.array),
      shading: "smooth",
      material: new MeshMaterialMetallicRoughness({
        color: [255, 255, 255, 1], alphaMode: "blend", doubleSided: false,
        metallic: 0, roughness: 0.55, colorTexture: foamTexture()
      })
    }],
    transform: { rotationAxis: [0, 0, 1], rotationAngle: -sampleReveal(0).heading }
  });
  const layer = new GraphicsLayer({
    id: "godzilla-wake-study",
    title: "Godzilla water wake (visual study)",
    listMode: "hide",
    visible: false,
    elevationInfo: { mode: "absolute-height" }
  });
  layer.add(new Graphic({
    geometry: mesh,
    symbol: { type: "mesh-3d", symbolLayers: [{ type: "fill", castShadows: false }] }
  }));
  view.map.add(layer);
  const field = createWakeField();
  const sampled = { height: 0, foam: 0 };
  let layerView;
  let enabled = false;
  let lastFrame = -1;
  let lastContactTime = -Infinity;
  let contact = null;
  let disposed = false;

  function reset() {
    field.reset();
    lastFrame = -1;
    lastContactTime = -Infinity;
    contact = null;
    for (let index = 0; index < vertices.count; index++) {
      positions[index * 3 + 2] = 0.04;
      vertices.setZ(index, 0.04);
      colors[index * 4] = 220;
      colors[index * 4 + 1] = 232;
      colors[index * 4 + 2] = 236;
      colors[index * 4 + 3] = 0;
    }
    geometry.computeVertexNormals();
    normals.set(geometry.attributes.normal.array);
    mesh.vertexAttributesChanged();
  }
  function update(state, seconds, getContact) {
    if (!enabled || disposed) return;
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid wake clock");
    const frame = Math.floor(seconds * 15);
    if (frame === lastFrame) return;
    lastFrame = frame;
    if (seconds <= DURATION_S + 0.3 && seconds - lastContactTime >= 0.18) {
      contact = getContact();
      lastContactTime = seconds;
    }
    let source = null;
    if (contact) {
      const root = wakeCoordinates(state.x, state.y);
      const before = sampleReveal(Math.max(0, seconds - 0.05));
      const after = sampleReveal(seconds + 0.05);
      const distance = Math.hypot(after.x - before.x, after.y - before.y) / Math.cosh(END.y / 6378137);
      source = {
        x: root.x + (contact.minX + contact.maxX) / 2,
        y: root.y + (contact.minY + contact.maxY) / 2,
        radiusX: (contact.maxX - contact.minX) / 2,
        radiusY: (contact.maxY - contact.minY) / 2,
        speed: distance / 0.1,
        surge: Math.max(0, after.rise - before.rise) / 0.1 * HEIGHT_M * 0.56
      };
    }
    field.update(seconds, source);
    layer.visible = field.active;
    if (!field.active) return;
    for (let index = 0; index < vertices.count; index++) {
      const offset = index * 3;
      field.sample(positions[offset], positions[offset + 1], sampled);
      const z = 0.04 + sampled.height;
      positions[offset + 2] = z;
      vertices.setZ(index, z);
      colors[index * 4 + 3] = Math.round(255 * Math.min(0.78, Math.sqrt(sampled.foam) * 0.78 + Math.abs(sampled.height) * 0.035));
    }
    geometry.computeVertexNormals();
    normals.set(geometry.attributes.normal.array);
    mesh.vertexAttributesChanged();
  }
  const backend = {
    reset, update,
    get readyToDraw() { return !!layerView && !layerView.updating && !layerView.suspended; },
    setVisible(value) {
      enabled = value;
      layer.visible = value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      view.map.remove(layer);
      layer.destroy();
      geometry.dispose();
    }
  };
  reset();
  try {
    layerView = await view.whenLayerView(layer);
  } catch (error) {
    backend.dispose();
    throw error;
  }
  return backend;
}
