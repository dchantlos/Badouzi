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

export function waitForSceneReady(view, model, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let quietTimer;
    let timeout;
    let handle;
    let finished = false;

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(timeout);
      handle?.remove();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    function abort() {
      finish(signal.reason ?? new DOMException("Scene readiness wait cancelled", "AbortError"));
    }
    function check() {
      clearTimeout(quietTimer);
      if (view.fatalError) {
        finish(new Error(`Scene rendering failed: ${view.fatalError.message}`, { cause: view.fatalError }));
      } else if (isSceneReady(view, model)) {
        // A brief idle gap between tile batches is not a finished scene.
        quietTimer = setTimeout(() => {
          if (isSceneReady(view, model)) finish();
          else check();
        }, 2000);
      }
    }
    if (signal?.aborted) {
      abort();
      return;
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
    timeout = setTimeout(() => finish(new Error(
      "The scene is still loading. Wait for the water and scenery to finish rendering, then retry."
    )), 60000);
    check();
  });
}
