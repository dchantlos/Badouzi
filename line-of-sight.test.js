import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSightResults } from "./line-of-sight.js";

test("line-of-sight results distinguish visible, blocked and unavailable targets", () => {
  const targets = [{}, {}, {}, {}];
  const results = [
    { target: targets[0], visible: true },
    { target: targets[1], visible: false },
    null,
    undefined
  ];
  assert.deepEqual(summarizeSightResults(targets, results, false), {
    visible: 1, blocked: 1, pending: 0, unavailable: 2
  });
});

test("results match target identity instead of relying on collection order", () => {
  const first = {}, second = {}, cursor = {};
  assert.deepEqual(summarizeSightResults([first, second], [
    { target: cursor, visible: true },
    { target: second, visible: false },
    { target: first, visible: true }
  ], false), { visible: 1, blocked: 1, pending: 0, unavailable: 0 });
});

test("loading scene detail does not present previous results as current", () => {
  const target = {};
  assert.deepEqual(summarizeSightResults([target, {}], [{ target, visible: true }], true), {
    visible: 0, blocked: 0, pending: 2, unavailable: 0
  });
});

test("missing or non-boolean visibility is never counted as a clear sight line", () => {
  const targets = [{}, {}, {}];
  const results = [
    { target: targets[0] },
    { target: targets[1], visible: null },
    { target: targets[2], visible: "false" }
  ];
  assert.deepEqual(summarizeSightResults(targets, results, false), {
    visible: 0, blocked: 0, pending: 0, unavailable: 3
  });
});

test("cleared targets leave no stale counts even while old results remain", () => {
  assert.deepEqual(summarizeSightResults([], [{ target: {}, visible: true }], false), {
    visible: 0, blocked: 0, pending: 0, unavailable: 0
  });
});
