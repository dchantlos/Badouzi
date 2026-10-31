import test from "node:test";
import assert from "node:assert/strict";
import { prepareFieldAssets } from "./field-assets.js";

const item = (key, overrides = {}) => ({
  key, x: 13557720, y: 2893360, groundZ: 3.2, sr: { wkid: 3857 },
  attributes: { Condition_Score: 4 }, ...overrides
});
const input = (id, items) => ({ id, label: id, status: "ok", items });

test("field markers reuse the actual point records and their captured attributes", () => {
  const bollard = item("bollards:1"), light = item("streetlights:1");
  const result = prepareFieldAssets([input("bollards", [bollard]), input("streetlights", [light])]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0], bollard);
  assert.equal(result.items[1], light);
  assert.equal(result.items[0].attributes.Condition_Score, 4);
});

test("a missing source is reported while valid records remain available", () => {
  const result = prepareFieldAssets([
    input("bollards", [item("bollards:1")]),
    { id: "streetlights", label: "streetlights", status: "failed", reason: "streetlights data unavailable" }
  ]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.issues, ["streetlights data unavailable"]);
});

test("unknown positions or elevations are reported instead of being placed at zero", () => {
  const result = prepareFieldAssets([
    input("bollards", [
      item("bollards:1", { groundZ: null }),
      item("bollards:2", { x: NaN }),
      item("bollards:3", { sr: null }),
      item("bollards:4", { groundZ: -0.5 })
    ]),
    input("streetlights", [])
  ]);
  assert.deepEqual(result.items.map(item => item.key), ["bollards:4"]);
  assert.deepEqual(result.issues, ["3 records could not be placed"]);
});

test("empty successful datasets stay distinct from unavailable inputs", () => {
  assert.deepEqual(prepareFieldAssets([input("bollards", []), input("streetlights", [])]), {
    items: [], issues: []
  });
  const failed = prepareFieldAssets([
    { id: "bollards", label: "bollards", status: "missing" },
    { id: "streetlights", label: "streetlights", status: "failed" }
  ]);
  assert.equal(failed.items.length, 0);
  assert.equal(failed.issues.length, 2);
});

test("BIM records, missing inputs and malformed successes fail explicitly", () => {
  assert.throws(() => prepareFieldAssets([]), /Both field-data/);
  assert.throws(() => prepareFieldAssets([input("bollards", [])]), /Both field-data/);
  assert.throws(() => prepareFieldAssets([input("bollards", []), input("bim", [])]), /point|bollard and streetlight/);
  assert.throws(() => prepareFieldAssets([input("bollards", undefined), input("streetlights", [])]), /Missing field records/);
});

test("duplicate record keys cannot create duplicate green orbs", () => {
  const duplicate = item("bollards:1");
  assert.throws(() => prepareFieldAssets([
    input("bollards", [duplicate, duplicate]), input("streetlights", [])
  ]), /Duplicate field record/);
});
