import { END, START } from "./timeline.js";

export const WAKE_GRID = { minX: -100, maxX: 100, minY: -90, maxY: 220, spacing: 2.5 };
export const WAKE_LIFETIME_S = 18;
const EMIT_INTERVAL_S = 1.1;
const length = Math.hypot(START.x - END.x, START.y - END.y);
const back = { x: (START.x - END.x) / length, y: (START.y - END.y) / length };
const mapScale = Math.cosh(END.y / 6378137);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function wakeCoordinates(x, y) {
  if (![x, y].every(Number.isFinite)) throw new TypeError("Wake coordinates must be finite");
  const dx = (x - END.x) / mapScale, dy = (y - END.y) / mapScale;
  return { x: dx * back.y - dy * back.x, y: dx * back.x + dy * back.y };
}

export function createWakeField() {
  let time = 0;
  let packets = [];
  let source = null;
  let emittedAt = -Infinity;
  let sequence = 0;
  let bounds = null;

  function reset() {
    time = 0;
    packets = [];
    source = null;
    emittedAt = -Infinity;
    sequence = 0;
    bounds = null;
  }
  function update(seconds, contact) {
    if (!Number.isFinite(seconds) || seconds < time) throw new RangeError("Reset the wake before restarting its clock");
    time = seconds;
    packets = packets.filter(packet => time - packet.born < WAKE_LIFETIME_S);
    if (contact) {
      const { x, y, radiusX, radiusY, speed, surge } = contact;
      if (![x, y, radiusX, radiusY, speed, surge].every(Number.isFinite) ||
        radiusX <= 0 || radiusY <= 0 || speed < 0 || surge < 0) throw new RangeError("Invalid wake source");
      const size = clamp(radiusX * radiusY / 500);
      const power = size * clamp(speed / 3 * 0.65 + surge / 4 * 0.35);
      source = { x, y, radiusX, radiusY, power };
      if (power > 0.015 && time - emittedAt >= EMIT_INTERVAL_S) {
        const wavelength = clamp(radiusX * 0.2 + 8, 10, 15);
        const k = Math.PI * 2 / wavelength;
        const omega = Math.sqrt(9.81 * k);
        const groupSpeed = omega / k / 2;
        const lateralSpeed = groupSpeed * 0.55;
        const aftSpeed = groupSpeed * 0.2;
        const branchAngle = Math.atan2(lateralSpeed, speed + aftSpeed);
        packets.push({
          ...source, born: time, k, omega, groupSpeed, lateralSpeed, aftSpeed,
          branchSin: Math.sin(branchAngle), branchCos: Math.cos(branchAngle),
          radial: clamp(surge / 5), phase: Math.sin(sequence++ * 2.39) * 0.35
        });
        emittedAt = time;
      }
    } else source = null;
    bounds = null;
    function include(minX, maxX, minY, maxY) {
      if (!bounds) bounds = { minX, maxX, minY, maxY };
      else {
        bounds.minX = Math.min(bounds.minX, minX);
        bounds.maxX = Math.max(bounds.maxX, maxX);
        bounds.minY = Math.min(bounds.minY, minY);
        bounds.maxY = Math.max(bounds.maxY, maxY);
      }
    }
    for (const packet of packets) {
      packet.age = time - packet.born;
      packet.travel = packet.groupSpeed * packet.age;
      packet.fade = smooth(packet.age / 0.6) * (1 - packet.age / WAKE_LIFETIME_S) ** 2 /
        Math.sqrt(1 + packet.age * 0.25);
      packet.width = 2.5 + packet.age * 0.18;
      packet.reach = 6 + packet.age * 0.75;
      packet.centreX = packet.radiusX * 0.98 + packet.lateralSpeed * packet.age;
      packet.centreY = packet.radiusY * 0.65 + packet.aftSpeed * packet.age;
      const extentX = packet.branchCos * packet.width * 3 + packet.branchSin * packet.reach * 2.5;
      const extentY = packet.branchSin * packet.width * 3 + packet.branchCos * packet.reach * 2.5;
      packet.boundX = Math.max(packet.radiusX + packet.travel + 16, packet.centreX + extentX);
      packet.minY = Math.min(-packet.radiusY - packet.travel - 16, packet.centreY - extentY);
      packet.maxY = Math.max(packet.radiusY + packet.travel + 16, packet.centreY + extentY);
      include(packet.x - packet.boundX, packet.x + packet.boundX, packet.y + packet.minY, packet.y + packet.maxY);
    }
    if (source?.power > 0) include(source.x - source.radiusX - 22, source.x + source.radiusX + 22,
      source.y - source.radiusY - 22, source.y + source.radiusY + 22);
  }
  function sample(x, y, result = { height: 0, foam: 0 }) {
    if (!bounds || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY ||
      (source && ((x - source.x) / source.radiusX) ** 2 + ((y - source.y) / source.radiusY) ** 2 <= 0.96 ** 2)) {
      result.height = result.foam = 0;
      return result;
    }
    let height = 0, foam = 0;
    for (const packet of packets) {
      if (Math.abs(x - packet.x) > packet.boundX || y - packet.y < packet.minY || y - packet.y > packet.maxY) continue;
      const { width, reach } = packet;
      for (let side = -1; side <= 1; side += 2) {
        const centreX = packet.x + side * packet.centreX;
        const centreY = packet.y + packet.centreY;
        const dx = x - centreX, dy = y - centreY;
        const across = side * dx * packet.branchCos - dy * packet.branchSin;
        const along = side * dx * packet.branchSin + dy * packet.branchCos;
        if (Math.abs(across) > width * 3 || Math.abs(along) > reach * 2.5) continue;
        const envelope = Math.exp(-0.5 * ((across / width) ** 2 + (along / reach) ** 2));
        const energy = packet.power * packet.fade * envelope;
        const wave = Math.cos(packet.k * across);
        height += wave * energy * 0.38;
        foam += Math.max(0, (wave - 0.2) / 0.8) ** 2 * energy * 0.8;
      }
      const dx = x - packet.x, dy = y - packet.y;
      if (Math.abs(dx) > packet.radiusX + packet.travel + 16 ||
        Math.abs(dy) > packet.radiusY + packet.travel + 16) continue;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 0.001) continue;
      const churnX = dx / (packet.radiusX * 0.55 + packet.age * 0.35);
      const churnY = (dy - packet.radiusY * 0.85) / (5 + packet.age * 0.65);
      foam += Math.exp(-2 * (churnX * churnX + churnY * churnY)) * packet.power *
        Math.exp(-packet.age / 5) * 0.15;
      if (packet.radial < 0.05) continue;
      const ellipseRadius = distance / Math.sqrt(dx * dx / packet.radiusX ** 2 + dy * dy / packet.radiusY ** 2);
      const edge = distance - ellipseRadius;
      const band = (edge - packet.travel) / 6;
      if (edge < 0 || Math.abs(band) > 2.5) continue;
      const envelope = Math.exp(-0.5 * band * band);
      const aft = 0.18 + 0.82 * smooth((dy / distance + 0.15) / 0.9);
      const direction = aft + (1 - aft) * packet.radial * 0.7;
      const energy = packet.power * packet.fade * envelope * direction * packet.radial * 0.2;
      const wave = Math.sin(packet.k * edge - packet.omega * packet.age + packet.phase);
      height += wave * energy * 0.38;
      foam += Math.max(0, (wave - 0.25) / 0.75) ** 2 * energy * 0.8;
    }
    let outside = 1;
    if (source) {
      const dx = x - source.x, dy = y - source.y;
      const normalized = Math.sqrt(dx * dx / source.radiusX ** 2 + dy * dy / source.radiusY ** 2);
      outside = smooth((normalized - 0.96) / 0.14);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 0.001 && normalized > 0.95 && source.power > 0) {
        const edge = distance - distance / normalized;
        if (edge > 0 && edge < 22) {
          const front = smooth((-dy / distance - 0.05) / 0.75);
          const crest = Math.exp(-0.5 * ((edge - 3.5) / 2.1) ** 2) +
            0.32 * Math.exp(-0.5 * ((edge - 12) / 2.7) ** 2);
          const broken = 0.8 + 0.2 * Math.sin(dx * 0.21 + time * 0.9);
          height += crest * front * source.power * 0.44 * broken;
          foam += crest * front * source.power * 0.65 * broken;
        }
      }
    }
    const edgeFade = smooth(Math.min(x - WAKE_GRID.minX, WAKE_GRID.maxX - x,
      y - WAKE_GRID.minY, WAKE_GRID.maxY - y) / 12);
    const breakup = 0.65 + 0.35 * Math.sin(x * 0.37 + Math.sin(y * 0.19)) * Math.sin(y * 0.43 - time * 0.3);
    result.height = clamp(height, -0.25, 0.7) * outside * edgeFade;
    result.foam = clamp(foam * breakup) * outside * edgeFade;
    return result;
  }
  return {
    update, sample, reset,
    get active() { return packets.length > 0 || (source?.power ?? 0) > 0.001; },
    get packetCount() { return packets.length; }
  };
}
