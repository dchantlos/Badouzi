import { Euler, Quaternion } from "three";

export function createJointMotion(model, names, label) {
  model.updateMatrixWorld(true);
  const joints = Object.entries(names).map(([key, name]) => {
    const bone = model.getObjectByName(name);
    if (!bone?.isBone) throw new Error(`Godzilla ${label} joint is missing: ${name}`);
    const basis = bone.getWorldQuaternion(new Quaternion());
    return { key, bone, basis, inverseBasis: basis.clone().invert(), base: bone.quaternion.clone() };
  });
  const euler = new Euler(0, 0, 0, "ZYX");
  const rotation = new Quaternion();
  const localRotation = new Quaternion();
  let applied = false;

  // The mixer can skip unchanged tracks, so remove additive offsets first.
  function restore() {
    if (!applied) return;
    for (const { bone, base } of joints) bone.quaternion.copy(base);
    applied = false;
  }
  function apply(pose) {
    for (const { key } of joints) {
      if (!pose[key] || !["pitch", "yaw", "roll"].every(axis => Number.isFinite(pose[key][axis]))) {
        throw new RangeError(`Invalid Godzilla ${label} rotation: ${key}`);
      }
    }
    restore();
    for (const { key, bone, basis, inverseBasis, base } of joints) {
      base.copy(bone.quaternion);
      const { pitch, yaw, roll } = pose[key];
      rotation.setFromEuler(euler.set(pitch, yaw, roll));
      localRotation.copy(inverseBasis).multiply(rotation).multiply(basis);
      bone.quaternion.multiply(localRotation).normalize();
    }
    applied = true;
  }
  return { apply, restore };
}
