import test from "node:test";
import assert from "node:assert/strict";
import { waterContactBounds } from "./water-contact.js";

const vertices = new Float64Array([
  -1, -2, -1, 1, -2, -1, 1, 2, -1, -1, 2, -1,
  -1, -2, 1, 1, -2, 1, 1, 2, 1, -1, 2, 1
]);
const faces = new Uint32Array([
  0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7
]);

test("the water contact comes from real triangle-plane intersections in metres", () => {
  assert.deepEqual(waterContactBounds(vertices, faces, 0, 2), { minX: -2, maxX: 2, minY: -4, maxY: 4 });
});

test("fully submerged and fully dry geometry do not emit a surface wake", () => {
  assert.equal(waterContactBounds(vertices, faces, 2, 1), null);
  assert.equal(waterContactBounds(vertices, faces, -2, 1), null);
});

test("vertices exactly on the waterline remain valid contacts", () => {
  assert.deepEqual(waterContactBounds(vertices, faces, 1, 1), { minX: -1, maxX: 1, minY: -2, maxY: 2 });
});

test("water-contact sampling does not modify the model", () => {
  const before = vertices.slice();
  waterContactBounds(vertices, faces, 0.5, 1.4);
  assert.deepEqual(vertices, before);
});

test("invalid water geometry is rejected explicitly", () => {
  assert.throws(() => waterContactBounds(vertices, faces, NaN, 1), RangeError);
  assert.throws(() => waterContactBounds(vertices, faces, 0, 0), RangeError);
  assert.throws(() => waterContactBounds(vertices, new Uint32Array([0, 1, 100]), 0, 1), RangeError);
});
