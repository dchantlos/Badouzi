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
export const EYE_BONES = { left: "bip_eye_l_95", right: "bip_eye_r_96" };
const chain = {
  neckBase: { weight: 0.12, lag: 0 },
  neckLower: { weight: 0.18, lag: 0.07 },
  neckUpper: { weight: 0.22, lag: 0.15 },
  neckTip: { weight: 0.18, lag: 0.25 },
  head: { weight: 0.30, lag: 0.38 }
};
const IDLE_PERIOD_S = 16;
const cues = [
  { time: 0, pitch: 0, yaw: 0, roll: 0, jaw: 0 },
  { time: 5, pitch: 0, yaw: 0, roll: 0, jaw: 0 },
  { time: 12, pitch: -10, yaw: -9, roll: -1.3, jaw: 5 },
  { time: 16, pitch: 4, yaw: 7, roll: 1, jaw: -1 },
  { time: RISE_END_S, pitch: -7, yaw: 10, roll: 1, jaw: 10 },
  { time: CHARGE_START_S + 2, pitch: 6, yaw: 14, roll: 1.6, jaw: 3 },
  { time: CHARGE_START_S + 6, pitch: -13, yaw: -18, roll: -2, jaw: 11 },
  { time: CHARGE_START_S + 9, pitch: -19, yaw: 8, roll: 1.8, jaw: 22 },
  { time: CHARGE_START_S + 13, pitch: -5, yaw: 16, roll: 2, jaw: 9 },
  { time: CHARGE_START_S + 17, pitch: -10, yaw: -11, roll: -1.6, jaw: 17 },
  { time: DURATION_S, pitch: -3, yaw: 0, roll: 0, jaw: 3.5 }
];
const idleCues = [
  { ...cues.at(-1), time: 0 },
  { time: 2.5, pitch: -9, yaw: -16, roll: -1.8, jaw: 11 },
  { time: 5, pitch: -18, yaw: -7, roll: -0.5, jaw: 23 },
  { time: 7.5, pitch: -5, yaw: 14, roll: 1.8, jaw: 7 },
  { time: 10, pitch: 4, yaw: 20, roll: 2.1, jaw: 2 },
  { time: 12.5, pitch: -12, yaw: 6, roll: 0.8, jaw: 18 },
  { ...cues.at(-1), time: IDLE_PERIOD_S }
];
function ease(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function cueAt(seconds) {
  const sequence = seconds > DURATION_S ? idleCues : cues;
  const time = seconds > DURATION_S ? (seconds - DURATION_S) % IDLE_PERIOD_S : seconds;
  if (time <= sequence[0].time) return sequence[0];
  for (let index = 1; index < sequence.length; index++) {
    const end = sequence[index];
    if (time > end.time) continue;
    const start = sequence[index - 1];
    const amount = ease((time - start.time) / (end.time - start.time));
    return Object.fromEntries(["pitch", "yaw", "roll", "jaw"]
      .map(axis => [axis, start[axis] + (end[axis] - start[axis]) * amount]));
  }
  return sequence.at(-1);
}

export function sampleHeadMotion({ seconds, rise, approach }) {
  if (!Number.isFinite(seconds) || seconds < 0 ||
    ![rise, approach].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError("Head motion needs a nonnegative clock and rise/approach between zero and one");
  }
  const strength = ease((rise - 0.15) / 0.85);
  const radians = degrees => degrees * Math.PI / 180 * strength;
  const gait = 1.3 * Math.sin(approach * WALK_CYCLES * Math.PI * 2) * Math.sin(approach * Math.PI);
  const pose = {};
  for (const [joint, { weight, lag }] of Object.entries(chain)) {
    const time = seconds - lag;
    const cue = cueAt(time);
    const breath = 0.7 * Math.sin(time * Math.PI * 4 / IDLE_PERIOD_S) +
      0.2 * Math.sin(time * Math.PI * 2 / IDLE_PERIOD_S + 0.8);
    pose[joint] = {
      pitch: radians((cue.pitch + breath + gait) * weight),
      yaw: radians((cue.yaw + 0.6 * Math.sin(time * Math.PI * 2 / IDLE_PERIOD_S + 0.7)) * weight),
      roll: radians((cue.roll + 0.3 * Math.sin(time * Math.PI * 4 / IDLE_PERIOD_S + 0.2)) * weight)
    };
  }
  const jaw = cueAt(seconds - 0.45);
  pose.jaw = {
    pitch: radians(jaw.jaw + 0.35 * (1 + Math.sin(seconds * Math.PI * 4 / IDLE_PERIOD_S - 0.7))),
    yaw: 0,
    roll: 0
  };
  return pose;
}

export function createHeadMotion(model) {
  return createJointMotion(model, HEAD_BONES, "head");
}
