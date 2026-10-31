import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnimationClip, AnimationMixer, Bone, Group, Object3D, QuaternionKeyframeTrack, Vector3 } from "three";
import { HEAD_BONES, createHeadMotion, sampleHeadMotion } from "./head-motion.js";
import { sampleReveal } from "./timeline.js";

const bytes = readFileSync(new URL("./godzilla-walk.glb", import.meta.url));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
function rig() {
  const jointIndices = new Set(gltf.skins.flatMap(skin => skin.joints));
  const nodes = gltf.nodes.map((node, index) => {
    const object = jointIndices.has(index) ? new Bone() : new Object3D();
    object.name = node.name;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    if (node.matrix) object.matrix.fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    return object;
  });
  gltf.nodes.forEach((node, index) => (node.children || []).forEach(child => nodes[index].add(nodes[child])));
  const model = new Group();
  gltf.scenes[gltf.scene || 0].nodes.forEach(index => model.add(nodes[index]));
  model.updateMatrixWorld(true);
  return model;
}
const sample = seconds => sampleHeadMotion({ seconds, ...sampleReveal(seconds) });
const total = (pose, axis) => Object.entries(pose)
  .filter(([joint]) => joint !== "jaw").reduce((sum, [, angles]) => sum + angles[axis], 0);

test("the actual supplied rig contains the complete neck/skull/jaw chain", () => {
  const model = rig();
  const names = Object.values(HEAD_BONES);
  for (let index = 1; index < names.length; index++) {
    assert.equal(model.getObjectByName(names[index]).parent.name, names[index - 1]);
  }
  assert.doesNotThrow(() => createHeadMotion(model));
});

test("head offsets stay inactive until the head is emerging", () => {
  for (const rise of [0, 0.1, 0.15]) {
    const pose = sampleHeadMotion({ seconds: 15, rise, approach: 0 });
    assert(Object.values(pose).every(angles => Object.values(angles).every(value => value === 0)));
  }
});

test("the close-up has a visible turn and chin lift instead of a static head", () => {
  const first = sample(27);
  const second = sample(29);
  assert(Math.abs(total(first, "yaw") - total(second, "yaw")) > 2 * Math.PI / 180);
  assert(total(second, "pitch") < total(first, "pitch"));
});

test("neck motion leads the skull rather than rotating the whole head as one block", () => {
  const pose = sample(28.5);
  assert(pose.head.yaw / 0.30 < pose.neckBase.yaw / 0.12);
});

test("dramatic head and jaw movement remains bounded and smoothly weighted", () => {
  let previous = sample(0);
  for (let frame = 1; frame <= 70 * 60; frame++) {
    const pose = sample(frame / 60);
    assert(Math.abs(total(pose, "pitch")) < 14 * Math.PI / 180);
    assert(Math.abs(total(pose, "yaw")) < 12 * Math.PI / 180);
    assert(Math.abs(total(pose, "roll")) < 2 * Math.PI / 180);
    assert(pose.jaw.pitch > -4 * Math.PI / 180 && pose.jaw.pitch < 14 * Math.PI / 180);
    for (const axis of ["pitch", "yaw", "roll"]) {
      const speed = Math.abs(total(pose, axis) - total(previous, axis)) * 60;
      assert(speed < 12 * Math.PI / 180, `${axis} moved too quickly at ${frame / 60}`);
    }
    previous = pose;
  }
});

test("the real jaw visibly opens for the charge, then relaxes instead of flapping", () => {
  const model = rig();
  const motion = createHeadMotion(model);
  const upper = model.getObjectByName("bip_lipT_1_l_101");
  const lower = model.getObjectByName("bip_lipB_1_l_68");
  function gap(time) {
    motion.apply(sample(time));
    model.updateMatrixWorld(true);
    return upper.getWorldPosition(new Vector3()).distanceTo(lower.getWorldPosition(new Vector3()));
  }
  const closed = gap(19);
  const open = gap(31);
  assert(open > closed + 1, `Jaw opening only changed from ${closed} to ${open}`);
  assert(gap(43) < open);
});

test("actual nose movement leaves all non-head bones, hands and feet unchanged", () => {
  const model = rig();
  const motion = createHeadMotion(model);
  const headBones = new Set();
  model.getObjectByName(HEAD_BONES.neckBase).traverse(object => headBones.add(object));
  const untouched = [];
  model.traverse(object => {
    if (object.isBone && !headBones.has(object)) untouched.push({ bone: object, matrix: [...object.matrixWorld.elements] });
  });
  assert(untouched.length > 50);
  motion.apply(sample(27));
  model.updateMatrixWorld(true);
  const nose = model.getObjectByName("bip_noseT_l_62");
  const first = nose.getWorldPosition(new Vector3());
  motion.apply(sample(29));
  model.updateMatrixWorld(true);
  assert(nose.getWorldPosition(new Vector3()).distanceTo(first) > 0.5);
  for (const { bone, matrix } of untouched) assert.deepEqual(bone.matrixWorld.elements, matrix);
});

test("gentle head motion continues after the body sequence ends", () => {
  const model = rig();
  const motion = createHeadMotion(model);
  const nose = model.getObjectByName("bip_noseT_l_62");
  motion.apply(sample(46));
  model.updateMatrixWorld(true);
  const first = nose.getWorldPosition(new Vector3());
  motion.apply(sample(49));
  model.updateMatrixWorld(true);
  assert(nose.getWorldPosition(new Vector3()).distanceTo(first) > 0.03);
  assert.deepEqual(sampleReveal(46), sampleReveal(49));
});

test("unchanged mixer tracks cannot accumulate neck or jaw rotations", () => {
  const model = rig();
  const motion = createHeadMotion(model);
  const tracks = Object.values(HEAD_BONES).map(name => {
    const quaternion = model.getObjectByName(name).quaternion.toArray();
    return new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...quaternion, ...quaternion]);
  });
  const mixer = new AnimationMixer(model);
  mixer.clipAction(new AnimationClip("base", 1, tracks)).play();
  let expected;
  for (let pass = 0; pass < 5; pass++) {
    motion.restore();
    mixer.setTime(0);
    motion.apply(sample(28));
    const actual = Object.values(HEAD_BONES).flatMap(name => model.getObjectByName(name).quaternion.toArray());
    if (!expected) expected = actual;
    else actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-12));
  }
});

test("reapplying a head pose is idempotent and invalid poses fail explicitly", () => {
  const model = rig();
  const motion = createHeadMotion(model);
  const pose = sample(28);
  motion.apply(pose);
  const before = model.getObjectByName(HEAD_BONES.head).quaternion.clone();
  motion.apply(pose);
  assert(before.angleTo(model.getObjectByName(HEAD_BONES.head).quaternion) < 1e-7);
  assert.throws(() => motion.apply({}), RangeError);
  assert.throws(() => createHeadMotion(new Group()), /head joint is missing/);
});

test("invalid clocks or movement progress are not silently accepted", () => {
  for (const state of [
    { seconds: -1, rise: 1, approach: 0 }, { seconds: NaN, rise: 1, approach: 0 },
    { seconds: 25, rise: 2, approach: 0 }, { seconds: 25, rise: 1, approach: Infinity }
  ]) assert.throws(() => sampleHeadMotion(state), RangeError);
});
