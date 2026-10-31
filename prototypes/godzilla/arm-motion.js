import { Quaternion, Vector3 } from "three";

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
  model.updateMatrixWorld(true);
  const arms = Object.entries(ARM_BONES).map(([side, names]) => ({
    side,
    joints: Object.entries(names).map(([joint, name]) => {
      const bone = model.getObjectByName(name);
      if (!bone?.isBone) throw new Error(`Godzilla arm joint is missing: ${name}`);
      const basis = bone.getWorldQuaternion(new Quaternion());
      return { joint, bone, basis, inverseBasis: basis.clone().invert(), base: bone.quaternion.clone() };
    })
  }));
  const x = new Vector3(1, 0, 0);
  const z = new Vector3(0, 0, 1);
  const pitch = new Quaternion();
  const spread = new Quaternion();
  const worldRotation = new Quaternion();
  const localRotation = new Quaternion();
  let applied = false;

  // Three.js skips writing unchanged animation tracks. Restore our offsets
  // before evaluating the mixer so a stationary pose cannot accumulate them.
  function restore() {
    if (!applied) return;
    for (const { joints } of arms) {
      for (const { bone, base } of joints) bone.quaternion.copy(base);
    }
    applied = false;
  }
  function apply(pose) {
    restore();
    for (const { side, joints } of arms) {
      const angles = pose[side];
      for (const { joint, bone, basis, inverseBasis, base } of joints) {
        base.copy(bone.quaternion);
        if (joint === "shoulder") {
          pitch.setFromAxisAngle(x, angles.shoulderPitch);
          spread.setFromAxisAngle(z, angles.shoulderSpread);
          worldRotation.copy(spread).multiply(pitch);
        } else {
          worldRotation.setFromAxisAngle(x, joint === "elbow" ? angles.elbowFlex : angles.wristPitch);
        }
        localRotation.copy(inverseBasis).multiply(worldRotation).multiply(basis);
        bone.quaternion.multiply(localRotation).normalize();
      }
    }
    applied = true;
  }
  return { apply, restore };
}
