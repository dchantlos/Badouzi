import test from "node:test";
import assert from "node:assert/strict";
import { AnimationClip, AnimationMixer, Bone, Group, QuaternionKeyframeTrack, Vector3 } from "three";
import { ARM_BONES, createArmMotion } from "./arm-motion.js";
import { WALK_CYCLES, sampleArmMotion } from "./timeline.js";

function rig() {
  const model = new Group();
  for (const [side, names] of Object.entries(ARM_BONES)) {
    const direction = side === "left" ? 1 : -1;
    const shoulder = new Bone();
    shoulder.name = names.shoulder;
    shoulder.position.set(direction * 8.85, 47, 13.36);
    shoulder.rotation.y = direction * 0.2;
    const elbow = new Bone();
    elbow.name = names.elbow;
    elbow.position.set(direction * 4.19, -11.42, -0.95);
    const wrist = new Bone();
    wrist.name = names.wrist;
    wrist.position.set(direction * 1.05, -2.72, 4.9);
    shoulder.add(elbow);
    elbow.add(wrist);
    model.add(shoulder);
  }
  const foot = new Bone();
  foot.name = "untouched-foot";
  foot.position.set(10, 0, 0);
  model.add(foot);
  model.updateMatrixWorld(true);
  return { model, foot };
}

test("arm lift is inactive before the visible rise", () => {
  for (const rise of [0, 0.1, 0.25]) {
    const pose = sampleArmMotion({ rise, approach: 0 });
    assert(Object.values(pose).every(arm => Object.values(arm).every(angle => angle === 0)));
  }
});

test("shoulders, elbows and wrists move with bounded, staggered strokes", () => {
  const first = sampleArmMotion({ rise: 1, approach: 0.25 / WALK_CYCLES });
  const second = sampleArmMotion({ rise: 1, approach: 0.75 / WALK_CYCLES });
  for (const side of ["left", "right"]) {
    assert(Math.abs(first[side].shoulderPitch - second[side].shoulderPitch) > 0.15);
    assert(Math.abs(first[side].elbowFlex - second[side].elbowFlex) > 0.25);
    assert.notEqual(first[side].wristPitch, second[side].wristPitch);
  }
  for (let step = 0; step <= 100; step++) {
    const pose = sampleArmMotion({ rise: 1, approach: step / 100 });
    assert(pose.left.shoulderSpread > 0);
    assert(pose.right.shoulderSpread < 0);
    for (const arm of Object.values(pose)) {
      assert(Math.abs(arm.shoulderPitch) <= 20 * Math.PI / 180 + 1e-12);
      assert(Math.abs(arm.shoulderSpread) <= 17 * Math.PI / 180 + 1e-12);
      assert(Math.abs(arm.elbowFlex) <= 35 * Math.PI / 180 + 1e-12);
      assert(Math.abs(arm.wristPitch) <= 3 * Math.PI / 180 + 1e-12);
    }
  }
});

test("the complete approach finishes on the same settled arm pose", () => {
  const start = sampleArmMotion({ rise: 1, approach: 0 });
  const end = sampleArmMotion({ rise: 1, approach: 1 });
  for (const side of ["left", "right"]) {
    for (const joint of Object.keys(start[side])) {
      assert(Math.abs(start[side][joint] - end[side][joint]) < 1e-12);
    }
  }
});

test("invalid arm motion is reported instead of silently defaulted", () => {
  for (const state of [
    { rise: NaN, approach: 0 }, { rise: 1, approach: Infinity },
    { rise: -1, approach: 0 }, { rise: 1, approach: 2 }
  ]) assert.throws(() => sampleArmMotion(state), RangeError);
});

test("joint offsets lift both hands without changing the lower body", () => {
  const { model, foot } = rig();
  const motion = createArmMotion(model);
  const before = Object.values(ARM_BONES).map(names =>
    model.getObjectByName(names.wrist).getWorldPosition(new Vector3()));
  const footBefore = foot.matrixWorld.clone();
  motion.apply(sampleArmMotion({ rise: 1, approach: 0.125 }));
  model.updateMatrixWorld(true);
  Object.values(ARM_BONES).forEach((names, index) => {
    const after = model.getObjectByName(names.wrist).getWorldPosition(new Vector3());
    assert(after.distanceTo(before[index]) > 3);
    assert(after.y > before[index].y);
  });
  assert.deepEqual(foot.matrixWorld.elements, footBefore.elements);
});

test("restoring the base pose prevents arm offsets accumulating on replay", () => {
  const { model } = rig();
  const motion = createArmMotion(model);
  const tracks = [];
  model.traverse(object => {
    if (!object.isBone) return;
    const quaternion = object.quaternion.toArray();
    tracks.push(new QuaternionKeyframeTrack(`${object.name}.quaternion`, [0, 1], [...quaternion, ...quaternion]));
  });
  const mixer = new AnimationMixer(model);
  mixer.clipAction(new AnimationClip("base", 1, tracks)).play();
  let expected;
  for (let pass = 0; pass < 4; pass++) {
    motion.restore();
    mixer.setTime(0);
    motion.apply(sampleArmMotion({ rise: 1, approach: 0.125 }));
    const result = [];
    model.traverse(object => { if (object.isBone) result.push(...object.quaternion.toArray()); });
    if (!expected) expected = result;
    else result.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-12));
  }
});

test("applying the same arm pose twice is idempotent", () => {
  const { model } = rig();
  const motion = createArmMotion(model);
  const pose = sampleArmMotion({ rise: 1, approach: 0.125 });
  motion.apply(pose);
  const before = model.getObjectByName(ARM_BONES.left.shoulder).quaternion.clone();
  motion.apply(pose);
  assert(before.angleTo(model.getObjectByName(ARM_BONES.left.shoulder).quaternion) < 1e-7);
});

test("a model missing the arm rig fails explicitly", () => {
  assert.throws(() => createArmMotion(new Group()), /arm joint is missing/);
});
