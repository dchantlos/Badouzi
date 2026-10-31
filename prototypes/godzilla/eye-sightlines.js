import LineOfSightAnalysis from "@arcgis/core/analysis/LineOfSightAnalysis.js";
import Point from "@arcgis/core/geometry/Point.js";
import { canProject, project } from "@arcgis/core/geometry/support/webMercatorUtils.js";

// Matched to the supplied rear-oblique screenshot using the three existing BIM landmarks.
export const HARBOUR_SIGHT_CAMERA = {
  position: { x: 13557933.813, y: 2894038.216, z: 230.220, spatialReference: { wkid: 3857 } },
  heading: 187.633742,
  tilt: 68.5625,
  fov: 55
};
// Picked on the pictured Gaussian-splat roofs, with a 0.5 m vertical clearance.
export const HARBOUR_ROOFTOP_TARGETS = [
  { key: "roof:central-tower", name: "Central tower roof",
    x: 13557719.460, y: 2893140.195, z: 40.055, sr: { wkid: 3857 } },
  { key: "roof:middle-apartments", name: "Neighbouring apartment roof",
    x: 13557676.622, y: 2893167.063, z: 31.748, sr: { wkid: 3857 } },
  { key: "roof:pale-apartments", name: "Pale apartment roof",
    x: 13557648.827, y: 2893185.731, z: 25.606, sr: { wkid: 3857 } }
];
const RETAINED_QUAYS = [
  { key: "bollards:136", name: "Bollard 235" },
  { key: "bollards:57", name: "Bollard 156" }
];

export function selectHarbourTargets({ buildings, quays, harbourExtent }, spatialReference) {
  if (buildings.length !== 3) throw new Error("Three building landmarks are required for the harbour view");
  if (harbourExtent?.type !== "extent" || !canProject(harbourExtent.spatialReference, spatialReference)) {
    throw new Error("The mapped harbour boundary is unavailable");
  }
  const boundary = project(harbourExtent, spatialReference);
  if (boundary?.type !== "extent" ||
    ![boundary.xmin, boundary.ymin, boundary.xmax, boundary.ymax].every(Number.isFinite)) {
    throw new Error("Cannot project the mapped harbour boundary");
  }
  const insideHarbour = ({ position }) => position.x >= boundary.xmin && position.x <= boundary.xmax &&
    position.y >= boundary.ymin && position.y <= boundary.ymax;
  function target(site) {
    if (!site.key || !site.name || !site.sr || ![site.x, site.y, site.z].every(Number.isFinite)) {
      throw new Error("A harbour target is missing its name or 3D location");
    }
    const source = new Point({ x: site.x, y: site.y, z: site.z, spatialReference: site.sr });
    if (!canProject(source.spatialReference, spatialReference)) {
      throw new Error(`Cannot project the harbour target: ${site.name}`);
    }
    const position = project(source, spatialReference);
    if (position?.type !== "point" || ![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new Error(`Invalid projected harbour target: ${site.name}`);
    }
    return { key: site.key, name: site.name, position };
  }
  const selected = [...buildings, ...HARBOUR_ROOFTOP_TARGETS].map(target);
  if (!selected.every(insideHarbour)) throw new Error("A building landmark is outside the mapped harbour");
  const candidates = quays.map(target).filter(insideHarbour);
  const distance = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  if (selected.some((site, index) => selected.slice(0, index).some(other =>
    site.key === other.key || distance(site, other) < 1))) {
    throw new Error("The building landmarks must have distinct locations");
  }
  for (const quay of RETAINED_QUAYS) {
    const saved = candidates.find(candidate => candidate.key === quay.key);
    if (!saved) throw new Error(`${quay.name} is unavailable within the mapped harbour`);
    if (selected.some(site => site.key === saved.key || distance(site, saved) < 1)) {
      throw new Error("The harbour sight-line targets must have distinct locations");
    }
    selected.push(saved);
  }
  return selected;
}

export function distributeEyeTargets(targets, observers) {
  if (targets.length !== 8) throw new Error("Godzilla's harbour view requires exactly eight targets");
  const left = observers.left.position, right = observers.right.position;
  const dx = left.x - right.x, dy = left.y - right.y;
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < 0.01) {
    throw new Error("Godzilla's two eye positions must be distinct");
  }
  const ordered = [...targets].sort((a, b) =>
    (b.position.x - a.position.x) * dx + (b.position.y - a.position.y) * dy ||
    a.key.localeCompare(b.key));
  return { left: ordered.slice(0, 4), right: ordered.slice(4) };
}

export async function createEyeSightLines(view, monster, targets, { signal }) {
  if (signal.aborted) throw signal.reason;
  const observers = monster.getEyeObservers();
  const groups = distributeEyeTargets(targets, observers);
  const analyses = ["left", "right"].map(eye => new LineOfSightAnalysis({
    id: `godzilla-eye-${eye}`,
    observer: observers[eye],
    targets: groups[eye].map(site => ({ position: site.position.clone() }))
  }));
  let disposed = false;
  let lastFrame = -1;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    view.analyses.removeMany(analyses);
    for (const analysis of analyses) analysis.destroy();
  }
  view.analyses.addMany(analyses);
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const analysisViews = await Promise.all(analyses.map(analysis => view.whenAnalysisView(analysis)));
    if (signal.aborted) throw signal.reason;
    for (const analysisView of analysisViews) analysisView.interactive = false;
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    targets,
    update(seconds) {
      if (disposed) return;
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid eye sight-line clock");
      const frame = Math.floor(seconds * 10);
      if (frame === lastFrame) return;
      lastFrame = frame;
      const eyes = monster.getEyeObservers();
      analyses[0].observer.position = eyes.left.position;
      analyses[1].observer.position = eyes.right.position;
    },
    cameraTarget() {
      const extent = monster.getFramingExtent();
      for (const { position } of targets) {
        extent.xmin = Math.min(extent.xmin, position.x);
        extent.xmax = Math.max(extent.xmax, position.x);
        extent.ymin = Math.min(extent.ymin, position.y);
        extent.ymax = Math.max(extent.ymax, position.y);
        extent.zmin = Math.min(extent.zmin, position.z);
        extent.zmax = Math.max(extent.zmax, position.z);
      }
      if (!extent.spatialReference.equals(view.spatialReference) ||
        ![extent.xmin, extent.ymin, extent.zmin, extent.xmax, extent.ymax, extent.zmax].every(Number.isFinite) ||
        extent.width > 10000 || extent.height > 10000) {
        throw new Error("Cannot frame sight-line locations outside the harbour area");
      }
      return {
        ...HARBOUR_SIGHT_CAMERA,
        position: {
          ...HARBOUR_SIGHT_CAMERA.position,
          spatialReference: { ...HARBOUR_SIGHT_CAMERA.position.spatialReference }
        }
      };
    },
    dispose
  };
}
