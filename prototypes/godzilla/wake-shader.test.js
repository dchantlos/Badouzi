import test from "node:test";
import assert from "node:assert/strict";
import { createWakeField } from "./wake-field.js";
import { MAX_WAKE_PACKETS, createWakeUniformData, writeWakeUniformData } from "./wake-shader.js";

const source = { x: 2.3, y: 30.7, radiusX: 10, radiusY: 20, speed: 3, surge: 1.5 };
function snapshot() {
  const field = createWakeField();
  field.update(0, source);
  field.update(1.2, { ...source, x: -3.7, y: 26.1 });
  return field.snapshot();
}
const floats = values => values.map(Math.fround);

test("shader uniforms start empty with valid radii and bounded packet buffers", () => {
  const data = createWakeUniformData();
  assert.deepEqual([...data.source], [0, 0, 1, 1]);
  assert.equal(data.hasSource, false);
  assert.equal(data.power, 0);
  assert.equal(data.count, 0);
  for (const buffer of [data.a, data.b, data.c, data.d]) {
    assert(buffer instanceof Float32Array);
    assert.equal(buffer.length, MAX_WAKE_PACKETS * 4);
    assert(buffer.every(value => value === 0));
  }
});

test("GPU packing preserves source, emission time, propagation and directional branch parameters", () => {
  const state = snapshot();
  const data = createWakeUniformData();
  writeWakeUniformData(data, state);
  assert.equal(data.hasSource, true);
  assert.equal(data.count, state.packets.length);
  assert.equal(data.power, state.source.power);
  assert.deepEqual([...data.source], floats([state.source.x, state.source.y, state.source.radiusX, state.source.radiusY]));
  for (const [index, packet] of state.packets.entries()) {
    const read = buffer => [...buffer.subarray(index * 4, index * 4 + 4)];
    assert.deepEqual(read(data.a), floats([packet.x, packet.y, packet.radiusX, packet.radiusY]));
    assert.deepEqual(read(data.b), floats([packet.born, packet.power, packet.radial, packet.phase]));
    assert.deepEqual(read(data.c), floats([packet.k, packet.omega, packet.lateralSpeed, packet.aftSpeed]));
    assert.deepEqual(read(data.d), floats([packet.branchSin, packet.branchCos, packet.groupSpeed, 0]));
  }
});

test("uniform uploads reuse their buffers without mutating a field snapshot", () => {
  const state = snapshot();
  const before = structuredClone(state);
  const data = createWakeUniformData();
  const buffers = [data.source, data.a, data.b, data.c, data.d];
  writeWakeUniformData(data, state);
  writeWakeUniformData(data, state);
  [data.source, data.a, data.b, data.c, data.d].forEach((buffer, index) => assert.equal(buffer, buffers[index]));
  assert.deepEqual(state, before);
});

test("an empty snapshot disables all old uniforms after Reset", () => {
  const data = createWakeUniformData();
  writeWakeUniformData(data, snapshot());
  writeWakeUniformData(data, { source: null, packets: [] });
  assert.equal(data.count, 0);
  assert.equal(data.hasSource, false);
  assert.equal(data.power, 0);
  assert.deepEqual([...data.source], [0, 0, 1, 1]);
});

test("a full GPU history fits exactly and overflow fails before changing active uniforms", () => {
  const state = snapshot();
  const data = createWakeUniformData();
  state.packets = Array.from({ length: MAX_WAKE_PACKETS }, () => ({ ...state.packets[0] }));
  writeWakeUniformData(data, state);
  assert.equal(data.count, MAX_WAKE_PACKETS);
  const before = structuredClone(data);
  state.packets.push({ ...state.packets[0] });
  assert.throws(() => writeWakeUniformData(data, state), RangeError);
  assert.deepEqual(data, before);
});
