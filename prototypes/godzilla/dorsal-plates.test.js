import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DORSAL_MAX_STRENGTH, DORSAL_REGIONS, dorsalEmission, partitionDorsalPlates } from "./dorsal-plates.js";

function suppliedBody() {
  const file = readFileSync(new URL("./godzilla-walk.glb", import.meta.url));
  assert.equal(file.toString("ascii", 0, 4), "glTF");
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.toString("utf8", 20, 20 + jsonLength).trim());
  const binary = 20 + jsonLength + 8;
  const primitive = gltf.meshes.find(mesh => mesh.name === "Object_0").primitives[0];
  const positionAccessor = gltf.accessors[primitive.attributes.POSITION];
  const positionView = gltf.bufferViews[positionAccessor.bufferView];
  assert.equal(positionAccessor.componentType, 5126);
  const positions = new Float64Array(positionAccessor.count * 3);
  for (let index = 0; index < positionAccessor.count; index++) {
    const offset = binary + (positionView.byteOffset || 0) +
      (positionAccessor.byteOffset || 0) + index * (positionView.byteStride || 12);
    positions[index * 3] = file.readFloatLE(offset);
    positions[index * 3 + 1] = -file.readFloatLE(offset + 8);
    positions[index * 3 + 2] = file.readFloatLE(offset + 4);
  }
  const indexAccessor = gltf.accessors[primitive.indices];
  const indexView = gltf.bufferViews[indexAccessor.bufferView];
  assert([5123, 5125].includes(indexAccessor.componentType));
  const size = indexAccessor.componentType === 5123 ? 2 : 4;
  const indices = Uint32Array.from({ length: indexAccessor.count }, (_, index) => {
    const offset = binary + (indexView.byteOffset || 0) + (indexAccessor.byteOffset || 0) +
      index * (indexView.byteStride || size);
    return size === 2 ? file.readUInt16LE(offset) : file.readUInt32LE(offset);
  });
  return { positions, indices };
}

test("the supplied model isolates 31 plate islands, not the skin or other mesh parts", () => {
  const { positions, indices } = suppliedBody();
  const result = partitionDorsalPlates(positions, indices);
  assert.equal(result.selectedIslands, 31);
  assert.deepEqual(Object.fromEntries(Object.entries(result.groups).map(([name, faces]) => [name, faces.length / 3])), {
    body: 32062, tail: 3416, back: 2764, crown: 4012
  });
  for (const region of DORSAL_REGIONS) {
    for (const vertex of result.groups[region]) {
      assert(Math.abs(positions[vertex * 3]) < 10);
      assert(positions[vertex * 3 + 1] > -24);
      assert(positions[vertex * 3 + 2] > 12);
    }
  }
});

test("partitioning retains every original triangle exactly once without changing vertices", () => {
  const { positions, indices } = suppliedBody();
  const originalPositions = positions.slice();
  const originalIndices = indices.slice();
  const { groups } = partitionDorsalPlates(positions, indices);
  const triangles = new Map();
  for (let index = 0; index < indices.length; index += 3) {
    const key = `${indices[index]},${indices[index + 1]},${indices[index + 2]}`;
    triangles.set(key, (triangles.get(key) || 0) + 1);
  }
  for (const faces of Object.values(groups)) {
    for (let index = 0; index < faces.length; index += 3) {
      const key = `${faces[index]},${faces[index + 1]},${faces[index + 2]}`;
      const count = triangles.get(key);
      assert(count > 0);
      if (count === 1) triangles.delete(key);
      else triangles.set(key, count - 1);
    }
  }
  assert.equal(triangles.size, 0);
  assert.deepEqual(positions, originalPositions);
  assert.deepEqual(indices, originalIndices);
});

test("invalid or unrecognized geometry is reported instead of making the whole model glow", () => {
  assert.throws(() => partitionDorsalPlates([0, 1], [0, 1, 2]), TypeError);
  assert.throws(() => partitionDorsalPlates([0, 0, 0], [0, 1, 2]), RangeError);
  assert.throws(() => partitionDorsalPlates([NaN, 0, 0], [0, 0, 0]), TypeError);
  assert.throws(() => partitionDorsalPlates([0, 0, 0], [0, 0, 0]), /could not be isolated safely/);
});

test("uncharged plates have neither blue emission color nor glow strength", () => {
  assert.deepEqual(dorsalEmission(0), { color: [0, 0, 0], strength: 0 });
});

test("the charged blue is brighter while still ramping smoothly", () => {
  assert.equal(DORSAL_MAX_STRENGTH, 7.5);
  assert.deepEqual(dorsalEmission(1), { color: [64, 200, 255], strength: 7.5 });
  assert.equal(dorsalEmission(0.5).strength, 3.75);
  assert(dorsalEmission(0.001).strength < 0.01);
  for (const invalid of [-1, 2, NaN, Infinity]) assert.throws(() => dorsalEmission(invalid), RangeError);
});
