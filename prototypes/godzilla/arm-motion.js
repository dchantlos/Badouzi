import { createJointMotion } from "./joint-motion.js";

export const ARM_BONES = {
  left: {
    shoulder: "bip_upperarm_l_39",
    elbow: "bip_lowerarm_l_38",
    wrist: "bip_hand_l_37"
  },
  right: {
    shoulder: "bip_upperarm_r_56",
    elbow: "bip_lowerarm_r_55",
    wrist: "bip_hand_r_54"
  }
};

export function createArmMotion(model) {
  const joints = Object.entries(ARM_BONES).flatMap(([side, names]) =>
    Object.entries(names).map(([joint, name]) => ({ side, joint, name, key: `${side}.${joint}` })));
  const motion = createJointMotion(model, Object.fromEntries(joints.map(({ key, name }) => [key, name])), "arm");
  return {
    restore: motion.restore,
    apply(pose) {
      const offsets = {};
      for (const { side, joint, key } of joints) {
        const angles = pose[side];
        offsets[key] = {
          pitch: joint === "shoulder" ? angles.shoulderPitch : joint === "elbow" ? angles.elbowFlex : angles.wristPitch,
          yaw: 0,
          roll: joint === "shoulder" ? angles.shoulderSpread : 0
        };
      }
      motion.apply(offsets);
    }
  };
}
