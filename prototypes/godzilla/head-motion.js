import { createJointMotion } from "./joint-motion.js";
import { CHARGE_START_S, DURATION_S, RISE_END_S, WALK_CYCLES } from "./timeline.js";

export const HEAD_BONES = {
  neckBase: "bip_neck_110",
  neckLower: "bip_neck_1_109",
  neckUpper: "bip_neck_2_107",
  neckTip: "bip_neck_3_104",
  head: "bip_head_103",
  jaw: "bip_jaw_79"
};
const chain = {
  neckBase: { weight: 0.12, lag: 0 },
  neckLower: { weight: 0.18, lag: 0.07 },
  neckUpper: { weight: 0.22, lag: 0.15 },
  neckTip: { weight: 0.18, lag: 0.25 },
  head: { weight: 0.30, lag: 0.38 }
};
const cues = [
  { time: 0, pitch: 0, yaw: 0, roll: 0, jaw: 0 },
  { time: 5, pitch: 0, yaw: 0, roll: 0, jaw: 0 },
  { time: 12, pitch: -7, yaw: -5, roll: -0.8, jaw: -2 },
  { time: RISE_END_S, pitch: -3, yaw: 2, roll: 0.2, jaw: -3 },
  { time: CHARGE_START_S + 2, pitch: 3, yaw: 6, roll: 0.6, jaw: -2 },
  { time: CHARGE_START_S + 6, pitch: -8, yaw: -10, roll: -1, jaw: 3 },
  { time: CHARGE_START_S + 9, pitch: -12, yaw: 4, roll: 1, jaw: 13 },
  { time: CHARGE_START_S + 14, pitch: -4, yaw: 0, roll: 0, jaw: 7.5 },
  { time: DURATION_S, pitch: -2, yaw: 0, roll: 0, jaw: 1.5 }
];
function ease(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function cueAt(seconds) {
  if (seconds <= cues[0].time) return cues[0];
  for (let index = 1; index < cues.length; index++) {
    const end = cues[index];
    if (seconds > end.time) continue;
    const start = cues[index - 1];
    const amount = ease((seconds - start.time) / (end.time - start.time));
    return Object.fromEntries(["pitch", "yaw", "roll", "jaw"]
      .map(axis => [axis, start[axis] + (end[axis] - start[axis]) * amount]));
  }
  return cues.at(-1);
}

export function sampleHeadMotion({ seconds, rise, approach }) {
  if (!Number.isFinite(seconds) || seconds < 0 ||
    ![rise, approach].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError("Head motion needs a nonnegative clock and rise/approach between zero and one");
  }
  const strength = ease((rise - 0.15) / 0.85);
  const radians = degrees => degrees * Math.PI / 180 * strength;
  const gait = 0.45 * Math.sin(approach * WALK_CYCLES * Math.PI * 2) * Math.sin(approach * Math.PI);
  const pose = {};
  for (const [joint, { weight, lag }] of Object.entries(chain)) {
    const time = seconds - lag;
    const cue = cueAt(time);
    const breath = 0.6 * Math.sin(time * Math.PI * 2 / 6.8) +
      0.15 * Math.sin(time * Math.PI * 2 / 10.9 + 0.8);
    pose[joint] = {
      pitch: radians((cue.pitch + breath + gait) * weight),
      yaw: radians((cue.yaw + 0.45 * Math.sin(time * Math.PI * 2 / 13 + 0.7)) * weight),
      roll: radians((cue.roll + 0.25 * Math.sin(time * Math.PI * 2 / 8.5 + 0.2)) * weight)
    };
  }
  const jaw = cueAt(seconds - 0.45);
  pose.jaw = {
    pitch: radians(jaw.jaw + 0.175 * (1 + Math.sin(seconds * Math.PI * 2 / 6.8 - 0.7))),
    yaw: 0,
    roll: 0
  };
  return pose;
}

export function createHeadMotion(model) {
  return createJointMotion(model, HEAD_BONES, "head");
}
