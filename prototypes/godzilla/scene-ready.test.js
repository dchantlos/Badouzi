import test from "node:test";
import assert from "node:assert/strict";
import Accessor from "@arcgis/core/core/Accessor.js";
import { isSceneReady, observeSceneReadiness, waitForSceneReady } from "./scene-ready.js";

const ViewState = Accessor.createSubclass({
  properties: {
    ready: { type: Boolean, value: true },
    stationary: { type: Boolean, value: true },
    updating: { type: Boolean, value: false },
    suspended: { type: Boolean, value: false },
    interacting: { type: Boolean, value: false },
    fatalError: { value: null },
    environment: { value: null }
  }
});
const ModelState = Accessor.createSubclass({
  properties: { readyToDraw: { type: Boolean, value: true } }
});

function setup(t, viewOptions = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const view = new ViewState(viewOptions);
  const model = new ModelState();
  t.after(() => { view.destroy(); model.destroy(); });
  return { view, model };
}

test("ready data still needs two seconds of stable rendering", async t => {
  const { view, model } = setup(t);
  let done = false;
  const wait = waitForSceneReady(view, model).then(() => { done = true; });
  t.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  await wait;
  assert.equal(done, true);
});

test("no rise while the scene or model renderer is updating", async t => {
  const { view, model } = setup(t, { updating: true });
  model.readyToDraw = false;
  let done = false;
  const wait = waitForSceneReady(view, model).then(() => { done = true; });
  t.mock.timers.tick(10000);
  view.updating = false;
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(done, false);
  model.readyToDraw = true;
  t.mock.timers.tick(2000);
  await wait;
});

test("the model's readiness getter tracks its actual layer-view updates", async t => {
  const { view } = setup(t);
  const layerView = new ViewState({ updating: true });
  t.after(() => layerView.destroy());
  const model = { get readyToDraw() { return !layerView.updating && !layerView.suspended; } };
  let done = false;
  const wait = waitForSceneReady(view, model).then(() => { done = true; });
  t.mock.timers.tick(10000);
  await Promise.resolve();
  assert.equal(done, false);
  layerView.updating = false;
  t.mock.timers.tick(2000);
  await wait;
});

test("new tile requests restart the entire settling interval", async t => {
  const { view, model } = setup(t);
  let done = false;
  const wait = waitForSceneReady(view, model).then(() => { done = true; });
  t.mock.timers.tick(1500);
  view.updating = true;
  t.mock.timers.tick(1000);
  view.updating = false;
  t.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  await wait;
});

test("camera motion, interaction and a suspended view cannot start the reveal", async t => {
  const { view, model } = setup(t, { stationary: false, interacting: true, suspended: true });
  const wait = waitForSceneReady(view, model);
  assert.equal(isSceneReady(view, model), false);
  view.stationary = true;
  view.interacting = false;
  t.mock.timers.tick(3000);
  assert.equal(isSceneReady(view, model), false);
  view.suspended = false;
  t.mock.timers.tick(2000);
  await wait;
});

test("lighting and weather changes restart the settling interval", async t => {
  const { view, model } = setup(t);
  let done = false;
  const wait = waitForSceneReady(view, model).then(() => { done = true; });
  t.mock.timers.tick(1500);
  view.environment = { lighting: { date: new Date(1000) }, weather: { type: "cloudy", cloudCover: 0.9 } };
  t.mock.timers.tick(1999);
  await Promise.resolve();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  await wait;
});

test("cancelling the wait prevents a later idle scene from triggering it", async t => {
  const { view, model } = setup(t, { updating: true });
  const controller = new AbortController();
  const wait = assert.rejects(waitForSceneReady(view, model, { signal: controller.signal }), { name: "AbortError" });
  controller.abort();
  await wait;
  view.updating = false;
  t.mock.timers.tick(60000);
});

test("an already cancelled wait fails immediately", async t => {
  const { view, model } = setup(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForSceneReady(view, model, { signal: controller.signal }), { name: "AbortError" });
});

test("a timeout reports the loading problem rather than starting early", async t => {
  const { view, model } = setup(t, { updating: true });
  const wait = assert.rejects(waitForSceneReady(view, model), /scene is still loading/);
  t.mock.timers.tick(60000);
  await wait;
});

test("rendering failures are surfaced explicitly", async t => {
  const { view, model } = setup(t);
  const wait = assert.rejects(waitForSceneReady(view, model), /Scene rendering failed: Context lost/);
  view.fatalError = new Error("Context lost");
  await wait;
});

test("a prepared encounter can await the user's confirmation without timing out", t => {
  const { view, model } = setup(t);
  const changes = [];
  const observer = observeSceneReadiness(view, model, {
    onChange: ready => changes.push(ready),
    onError: error => assert.fail(error.message)
  });
  t.after(() => observer.remove());
  t.mock.timers.tick(2000);
  assert.equal(observer.ready, true);
  t.mock.timers.tick(180000);
  assert.equal(observer.ready, true);
  assert.deepEqual(changes, [true]);
});

test("new loading disables Proceed and requires a fresh two-second stable interval", t => {
  const { view, model } = setup(t);
  const changes = [];
  const observer = observeSceneReadiness(view, model, {
    onChange: ready => changes.push(ready),
    onError: error => assert.fail(error.message)
  });
  t.after(() => observer.remove());
  t.mock.timers.tick(2000);
  view.updating = true;
  assert.equal(observer.ready, false);
  view.updating = false;
  t.mock.timers.tick(1999);
  assert.equal(observer.ready, false);
  t.mock.timers.tick(1);
  assert.equal(observer.ready, true);
  assert.deepEqual(changes, [true, false, true]);
});

test("lighting changes revoke readiness even before tile loading starts", t => {
  const { view, model } = setup(t);
  const observer = observeSceneReadiness(view, model, {
    onChange() {},
    onError: error => assert.fail(error.message)
  });
  t.after(() => observer.remove());
  t.mock.timers.tick(2000);
  view.environment = { lighting: { date: new Date(5000) } };
  assert.equal(observer.ready, false);
  t.mock.timers.tick(2000);
  assert.equal(observer.ready, true);
});

test("a later loading stall has its own timeout, not an expired confirmation deadline", t => {
  const { view, model } = setup(t);
  const errors = [];
  const observer = observeSceneReadiness(view, model, { onChange() {}, onError: error => errors.push(error) });
  t.mock.timers.tick(2000);
  t.mock.timers.tick(120000);
  view.updating = true;
  t.mock.timers.tick(59999);
  assert.equal(errors.length, 0);
  t.mock.timers.tick(1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /scene is still loading/);
  assert.equal(observer.ready, false);
});

test("cancelling while awaiting Proceed prevents any later readiness or timeout callbacks", t => {
  const { view, model } = setup(t);
  const controller = new AbortController();
  const changes = [], errors = [];
  const observer = observeSceneReadiness(view, model, {
    signal: controller.signal, onChange: ready => changes.push(ready), onError: error => errors.push(error)
  });
  t.mock.timers.tick(2000);
  controller.abort();
  view.updating = true;
  view.updating = false;
  t.mock.timers.tick(120000);
  assert.equal(observer.ready, false);
  assert.deepEqual(changes, [true]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "AbortError");
});
