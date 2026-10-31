import test from "node:test";
import assert from "node:assert/strict";
import Collection from "@arcgis/core/core/Collection.js";
import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import Point from "@arcgis/core/geometry/Point.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import { geographicToWebMercator, webMercatorToGeographic } from "@arcgis/core/geometry/support/webMercatorUtils.js";
import {
  HARBOUR_ROOFTOP_TARGETS, HARBOUR_SIGHT_CAMERA,
  createEyeSightLines, distributeEyeTargets, selectHarbourTargets
} from "./eye-sightlines.js";

const sr = SpatialReference.WebMercator;
const site = (key, x, y, z = 10) => ({ key, name: key, x, y, z, sr });
const data = () => ({
  harbourExtent: new Extent({
    xmin: 13557100, ymin: 2892600, xmax: 13558500, ymax: 2894100, spatialReference: sr
  }),
  buildings: [
    site("Fish Market", 13557720.751, 2893368.832),
    site("Exhibition Center", 13557745.795, 2893468.290),
    site("Bike Station", 13557770.170, 2893236.320)
  ],
  quays: [
    site("bollards:136", 13557952.440, 2893096.654),
    site("bollards:57", 13557948.040, 2893371.273),
    site("bollards:161", 13558179.736, 2893140.397),
    site("bollards:152", 13558069.873, 2893055.551),
    site("bollards:131", 13558027.969, 2893216.033)
  ]
});
const eye = (x, y) => ({ position: new Point({ x, y, z: 50, spatialReference: sr }) });
const observers = { left: eye(5, 0), right: eye(-5, 0) };

test("three leftmost quay rays are replaced by the pictured roofs while exactly eight remain", () => {
  const input = data();
  const before = input.quays.map(item => ({ ...item }));
  const targets = selectHarbourTargets(input, sr);
  assert.equal(targets.length, 8);
  assert.equal(new Set(targets.map(target => target.key)).size, 8);
  assert.deepEqual(targets.slice(0, 3).map(target => target.name), ["Fish Market", "Exhibition Center", "Bike Station"]);
  assert.deepEqual(targets.slice(3, 6).map(target => target.key), HARBOUR_ROOFTOP_TARGETS.map(target => target.key));
  assert.deepEqual(targets.slice(6).map(target => target.key), ["bollards:136", "bollards:57"]);
  assert(!targets.some(target => ["bollards:161", "bollards:152", "bollards:131"].includes(target.key)));
  assert.deepEqual(input.quays, before);
  assert(targets.every(target => target.position.spatialReference.isWebMercator));
});

test("quay selection is repeatable regardless of service result ordering", () => {
  const input = data();
  const expected = selectHarbourTargets(input, sr).map(target => target.key);
  input.quays.reverse();
  assert.deepEqual(selectHarbourTargets(input, sr).map(target => target.key), expected);
});

test("out-of-area service records cannot send harbour rays or the camera across the globe", () => {
  const input = data();
  const expected = selectHarbourTargets(input, sr).map(target => target.key);
  input.quays.push(site("distant-record", -11690236.9099, 4830817.2279, 1608));
  assert.deepEqual(selectHarbourTargets(input, sr).map(target => target.key), expected);
  input.buildings[0].x = 10000;
  assert.throws(() => selectHarbourTargets(input, sr), /outside the mapped harbour/);
});

test("geographic source points are projected before measuring harbour-wide separation", () => {
  const input = data();
  input.harbourExtent = webMercatorToGeographic(input.harbourExtent);
  for (const record of [...input.buildings, ...input.quays]) {
    const point = webMercatorToGeographic(new Point({ x: record.x, y: record.y, spatialReference: sr }));
    record.x = point.x;
    record.y = point.y;
    record.sr = SpatialReference.WGS84;
  }
  const targets = selectHarbourTargets(input, sr);
  assert(targets.every(target => target.position.x > 13550000 && target.position.y > 2890000));
  assert(targets.filter(target => !target.key.startsWith("roof:")).every(target => target.position.z === 10));
});

test("missing, duplicate or invalid landmarks produce explicit errors rather than fewer rays", () => {
  const input = data();
  assert.throws(() => selectHarbourTargets({ ...input, harbourExtent: null }, sr), /boundary is unavailable/);
  assert.throws(() => selectHarbourTargets({ ...input, buildings: input.buildings.slice(0, 2) }, sr), /Three building/);
  assert.throws(() => selectHarbourTargets({ ...input, quays: input.quays.slice(1) }, sr), /Bollard 235 is unavailable/);
  assert.throws(() => selectHarbourTargets({ ...input, quays: input.quays.filter(site => site.key !== "bollards:57") }, sr), /Bollard 156 is unavailable/);
  assert.throws(() => selectHarbourTargets({ ...input, buildings: [input.buildings[0], input.buildings[0], input.buildings[2]] }, sr), /distinct locations/);
  for (const invalid of [{ z: NaN }, { x: Infinity }, { sr: null }, { name: "" }]) {
    const changed = data();
    Object.assign(changed.buildings[0], invalid);
    assert.throws(() => selectHarbourTargets(changed, sr), /missing/);
  }
  input.buildings[0].sr = new SpatialReference({ wkid: 32651 });
  assert.throws(() => selectHarbourTargets(input, sr), /Cannot project/);
});

test("roof reference points stay in the intended waterfront building block", () => {
  const targets = selectHarbourTargets(data(), sr).filter(target => target.key.startsWith("roof:"));
  assert.equal(targets.length, 3);
  for (const target of targets) {
    const p = webMercatorToGeographic(target.position);
    assert(p.x > 121.7903 && p.x < 121.7912);
    assert(p.y > 25.1414 && p.y < 25.1421);
    assert(p.z > 25 && p.z < 41);
    const roundtrip = geographicToWebMercator(p);
    assert(Math.hypot(roundtrip.x - target.position.x, roundtrip.y - target.position.y) < 0.001);
  }
});

test("the supplied rear-oblique camera replaces automatic wide framing without exposing mutable defaults", async () => {
  const view = {
    spatialReference: sr, analyses: new Collection(),
    async whenAnalysisView() { return { interactive: false }; }
  };
  const model = {
    getEyeObservers: () => observers,
    getFramingExtent: () => new Extent({
      xmin: 13557720, ymin: 2893560, xmax: 13557820, ymax: 2893800,
      zmin: -50, zmax: 60, spatialReference: sr
    })
  };
  const backend = await createEyeSightLines(view, model, selectHarbourTargets(data(), sr),
    { signal: new AbortController().signal });
  try {
    const target = backend.cameraTarget();
    assert.deepEqual(target, HARBOUR_SIGHT_CAMERA);
    assert.equal(target.fov, 55);
    assert(Math.abs(target.heading - 187.633742) < 1e-6);
    assert(Math.abs(target.tilt - 68.5625) < 1e-6);
    assert.equal(target.position.z, 230.220);
    target.position.x = 0;
    target.position.spatialReference.wkid = 4326;
    assert.deepEqual(backend.cameraTarget(), HARBOUR_SIGHT_CAMERA);
  } finally { backend.dispose(); }
});

test("four unique targets belong to each eye, using the current eye-to-eye direction", () => {
  const targets = selectHarbourTargets(data(), sr);
  for (const eyes of [observers, { left: eye(0, 5), right: eye(0, -5) }]) {
    const groups = distributeEyeTargets(targets, eyes);
    assert.equal(groups.left.length, 4);
    assert.equal(groups.right.length, 4);
    assert.equal(new Set([...groups.left, ...groups.right]).size, 8);
    const dx = eyes.left.position.x - eyes.right.position.x;
    const dy = eyes.left.position.y - eyes.right.position.y;
    const side = target => target.position.x * dx + target.position.y * dy;
    assert(Math.min(...groups.left.map(side)) >= Math.max(...groups.right.map(side)));
  }
  assert.throws(() => distributeEyeTargets(targets.slice(1), observers), /exactly eight/);
  assert.throws(() => distributeEyeTargets(targets, { left: eye(0, 0), right: eye(0, 0) }), /distinct/);
});

test("native analyses track both eyes at 10 Hz and release all rays on abort", async () => {
  const controller = new AbortController();
  const views = [];
  const view = {
    analyses: new Collection(),
    async whenAnalysisView() { const result = { interactive: true }; views.push(result); return result; }
  };
  let samples = 0;
  const model = { getEyeObservers() { samples++; return { left: eye(5 + samples, 0), right: eye(-5 + samples, 0) }; } };
  const backend = await createEyeSightLines(view, model, selectHarbourTargets(data(), sr), { signal: controller.signal });
  assert.equal(view.analyses.length, 2);
  assert(view.analyses.every(analysis => analysis.targets.length === 4));
  assert(views.every(result => result.interactive === false));
  backend.update(43);
  const sampleCount = samples;
  backend.update(43.01);
  assert.equal(samples, sampleCount);
  backend.update(43.11);
  assert.equal(samples, sampleCount + 1);
  for (const clock of [-1, NaN, Infinity]) assert.throws(() => backend.update(clock), RangeError);
  controller.abort();
  assert.equal(view.analyses.length, 0);
  backend.update(44);
  assert.equal(samples, sampleCount + 1);
  backend.dispose();
});

test("cancelling while native views initialize cannot resurrect eye analyses", async () => {
  const controller = new AbortController();
  const pending = [];
  const view = {
    analyses: new Collection(),
    whenAnalysisView() { return new Promise(resolve => pending.push(resolve)); }
  };
  const creation = createEyeSightLines(view, { getEyeObservers: () => observers },
    selectHarbourTargets(data(), sr), { signal: controller.signal });
  const rejected = assert.rejects(creation, { name: "AbortError" });
  assert.equal(view.analyses.length, 2);
  controller.abort();
  assert.equal(view.analyses.length, 0);
  pending.forEach(resolve => resolve({ interactive: true }));
  await rejected;
  assert.equal(view.analyses.length, 0);
});

test("analysis initialization errors clean up both partially-created analyses", async () => {
  const error = new Error("Cannot initialize the native analysis");
  const view = { analyses: new Collection(), whenAnalysisView: () => Promise.reject(error) };
  await assert.rejects(createEyeSightLines(view, { getEyeObservers: () => observers },
    selectHarbourTargets(data(), sr), { signal: new AbortController().signal }), error);
  assert.equal(view.analyses.length, 0);
});
