import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";

export function isSceneReady(view, model) {
  return view.ready === true &&
    view.stationary === true &&
    view.updating === false &&
    view.suspended === false &&
    view.interacting === false &&
    !view.fatalError &&
    model.readyToDraw === true;
}

export function observeSceneReadiness(view, model, { signal, onChange, onError }) {
  let quietTimer;
  let timeout;
  let handle;
  let finished = false;
  let ready = false;

  function remove() {
    if (finished) return;
    finished = true;
    clearTimeout(quietTimer);
    clearTimeout(timeout);
    handle?.remove();
    signal?.removeEventListener("abort", abort);
  }
  function fail(error) {
    if (finished) return;
    remove();
    onError(error);
  }
  function change(value) {
    if (ready === value) return;
    ready = value;
    onChange(value);
  }
  function abort() {
    fail(signal.reason ?? new DOMException("Scene readiness wait cancelled", "AbortError"));
  }
  function check() {
    clearTimeout(quietTimer);
    change(false);
    if (view.fatalError) {
      fail(new Error(`Scene rendering failed: ${view.fatalError.message}`, { cause: view.fatalError }));
      return;
    }
    timeout ??= setTimeout(() => fail(new Error(
      "The scene is still loading. Wait for the water and scenery to finish rendering, then retry."
    )), 60000);
    if (isSceneReady(view, model)) {
      // A brief idle gap between tile batches is not a finished scene.
      quietTimer = setTimeout(() => {
        if (isSceneReady(view, model)) {
          clearTimeout(timeout);
          timeout = undefined;
          change(true);
        } else check();
      }, 2000);
    }
  }
  const observer = { remove, get ready() { return ready && !finished; } };
  if (signal?.aborted) {
    abort();
    return observer;
  }
  handle = reactiveUtils.watch(() => [
    view.ready, view.stationary, view.updating, view.suspended, view.interacting,
    view.fatalError, model.readyToDraw,
    view.environment?.lighting?.date?.getTime(),
    view.environment?.weather?.type,
    view.environment?.weather?.cloudCover,
    view.environment?.weather?.precipitation
  ], check, { sync: true });
  signal?.addEventListener("abort", abort, { once: true });
  check();
  return observer;
}

export function waitForSceneReady(view, model, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const observer = observeSceneReadiness(view, model, {
      signal,
      onChange(ready) {
        if (!ready) return;
        observer.remove();
        resolve();
      },
      onError: reject
    });
  });
}
