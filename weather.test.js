import test from "node:test";
import assert from "node:assert/strict";
import { dataValidTime, formatSiteTime, providerTimeToMs, weekdayOf } from "./weather.js";

// Run under any TZ (e.g. TZ=America/Los_Angeles npm test): results must not change.

test("timezone-less provider time is interpreted as Taipei wall-clock time", () => {
  const ms = providerTimeToMs("2026-10-30T08:00", 28800);
  assert.equal(ms, Date.UTC(2026, 9, 30, 0, 0));
  assert.equal(formatSiteTime(ms), "08:00");
});

test("data-valid time stays distinct from (older than) the retrieval time", () => {
  const data = { utc_offset_seconds: 28800, current: { time: "2026-10-30T07:30" } };
  const fetchedAt = Date.UTC(2026, 9, 29, 23, 38); // 07:38 Taipei
  assert.equal(formatSiteTime(dataValidTime(data)), "07:30");
  assert.equal(formatSiteTime(fetchedAt), "07:38");
  assert.ok(dataValidTime(data) < fetchedAt);
});

test("missing offset falls back to UTC+8 (Taiwan has no DST)", () => {
  const data = { current: { time: "2026-10-30T07:30" } };
  assert.equal(formatSiteTime(dataValidTime(data)), "07:30");
});

test("malformed or missing provider times are not invented", () => {
  assert.equal(providerTimeToMs(undefined, 28800), null);
  assert.equal(providerTimeToMs("yesterday", 28800), null);
  assert.equal(providerTimeToMs("2026-10-30T07:30", undefined), null);
  assert.equal(dataValidTime({}), null);
  assert.equal(dataValidTime({ current: {} }), null);
});

test("forecast weekday comes from the provider date, not the device timezone", () => {
  assert.equal(weekdayOf("2026-10-31"), "Sat");
  assert.equal(weekdayOf("2026-11-01"), "Sun");
  assert.equal(weekdayOf("bad"), null);
});
