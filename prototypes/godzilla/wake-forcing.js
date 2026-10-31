import { DURATION_S, END, HEIGHT_M, sampleReveal } from "./timeline.js";
import { createWakeField, wakeCoordinates } from "./wake-field.js";

export function createWakeForcing() {
  const field = createWakeField();
  let contact = null;
  let lastContactTime = -Infinity;
  return {
    update(state, seconds, getContact) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid wake clock");
      if (seconds <= DURATION_S + 0.3 && seconds - lastContactTime >= 0.18) {
        contact = getContact();
        lastContactTime = seconds;
      }
      let source = null;
      if (contact) {
        const root = wakeCoordinates(state.x, state.y);
        const before = sampleReveal(Math.max(0, seconds - 0.05));
        const after = sampleReveal(seconds + 0.05);
        const distance = Math.hypot(after.x - before.x, after.y - before.y) / Math.cosh(END.y / 6378137);
        source = {
          x: root.x + (contact.minX + contact.maxX) / 2,
          y: root.y + (contact.minY + contact.maxY) / 2,
          radiusX: (contact.maxX - contact.minX) / 2,
          radiusY: (contact.maxY - contact.minY) / 2,
          speed: distance / 0.1,
          surge: Math.max(0, after.rise - before.rise) / 0.1 * HEIGHT_M * 0.56
        };
      }
      field.update(seconds, source);
    },
    reset() {
      contact = null;
      lastContactTime = -Infinity;
      field.reset();
    },
    sample: field.sample,
    snapshot: field.snapshot,
    get active() { return field.active; }
  };
}
