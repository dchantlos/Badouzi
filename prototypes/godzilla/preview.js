import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import Camera from "@arcgis/core/Camera.js";
import { CAMERA_START, CAMERA_END, DURATION_S, RISE_END_S, sampleReveal } from "./timeline.js";
import { sampleCinematicCamera } from "./cinematic-camera.js";
import { waitForSceneReady } from "./scene-ready.js";
import "./preview.css";

export function setupGodzilla({
  view, getScenario, closeInspector, tools, isManualNavigationActive, onClose
}) {
  const panel = document.createElement("section");
  panel.className = "dock-section godzilla-preview";
  panel.id = "godzillaPreview";
  panel.dataset.state = "idle";
  panel.innerHTML = `
    <h2 class="dock-section-title">Godzilla
      <button class="godzilla-close" id="godzillaClose" type="button" aria-label="Hide Godzilla controls">&times;</button>
    </h2>
    <label class="godzilla-mode" for="godzillaMode">Sequence
      <select id="godzillaMode">
        <option value="reveal">Cinematic rise</option>
        <option value="walk">Slow wade</option>
      </select>
    </label>
    <p class="godzilla-status" role="status">Select +3m, then press G to reveal.</p>
    <div class="tool-grid">
      <button class="tool-btn" id="godzillaPlay" type="button">Play (G)</button>
      <button class="tool-btn" id="godzillaReset" type="button">Reset (Esc)</button>
    </div>
    <p class="godzilla-credit">
      V flies freely without stopping the creature.<br>
      Fictional effect; excluded from analysis.<br>
      Model: <a href="https://sketchfab.com/Draco120" target="_blank" rel="noopener noreferrer">Draco</a>,
      <a href="https://sketchfab.com/3d-models/godzilla-minus-one-godzillasaurus-b1f63bb4b5c64ad1b8988f0ca48e3138" target="_blank" rel="noopener noreferrer">Godzillasaurus</a>,
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.
      Adapted materials, animation and glow.
    </p>`;
  document.querySelector(".dock-panel").append(panel);
  const play = panel.querySelector("#godzillaPlay");
  const reset = panel.querySelector("#godzillaReset");
  const status = panel.querySelector(".godzilla-status");
  const variant = panel.querySelector("#godzillaMode");
  let monster;
  let loading;
  let active = false;
  let generation = 0;
  let frame = 0;
  let savedCamera;
  let cameraOwned = false;
  let disposed = false;
  let time = 0;
  let readinessController;

  function say(message, error = false) {
    status.textContent = message;
    panel.dataset.error = String(error);
  }
  function buttons() {
    play.disabled = getScenario() !== "+3m" || active;
    reset.disabled = !active;
    variant.disabled = active;
  }
  function loadMonster() {
    if (monster) return Promise.resolve(monster);
    loading ??= import("./animated-mesh.js")
      .then(({ createAnimatedMonster }) => createAnimatedMonster(view, { walking: true }))
      .then(loaded => {
        if (disposed) {
          loaded.dispose();
          return null;
        }
        monster = loaded;
        monster.setVisible(false);
        return monster;
      })
      .finally(() => { loading = null; });
    return loading;
  }
  function fail(error) {
    console.warn("[Badouzi Digital Twin] Godzilla:", error);
    stop(false);
    monster?.dispose();
    monster = null;
    loading = null;
    say(`Godzilla unavailable: ${error.message}. Press G to retry.`, true);
  }
  function fly(camera, duration) {
    return view.goTo(camera, { duration, easing: "ease-in-out" }).catch(error => {
      if (error.name !== "AbortError") throw error;
    });
  }
  function takeOverCamera() {
    const owned = cameraOwned;
    cameraOwned = false;
    savedCamera = null;
    if (owned) view.animation?.stop();
  }
  function stop(restore = true) {
    const run = ++generation;
    active = false;
    cancelAnimationFrame(frame);
    readinessController?.abort();
    readinessController = null;
    const camera = restore && cameraOwned && !isManualNavigationActive() ? savedCamera : null;
    if (cameraOwned) view.animation?.stop();
    cameraOwned = false;
    monster?.setVisible(false);
    savedCamera = null;
    if (camera) {
      cameraOwned = true;
      fly(camera, 1800).then(() => {
        if (run === generation) cameraOwned = false;
      }).catch(error => {
        if (run === generation && !disposed) fail(error);
      });
    }
    panel.dataset.state = "idle";
    say(getScenario() === "+3m" ? "Ready. G plays the offshore reveal." : "Select +3m, then press G to reveal.");
    buttons();
  }
  async function start() {
    if (active || disposed) return;
    if (getScenario() !== "+3m") {
      say("Godzilla is available only in the +3m scenario.");
      return;
    }
    if (tools.isActive()) {
      say("Clear the active analysis tool before starting the reveal.");
      return;
    }
    const run = ++generation;
    const controller = new AbortController();
    readinessController = controller;
    time = 0;
    active = true;
    cameraOwned = !isManualNavigationActive();
    savedCamera = cameraOwned ? view.camera.clone() : null;
    closeInspector();
    say("Preparing the model...");
    panel.dataset.state = "loading";
    buttons();
    try {
      const preparation = loadMonster().then(() => {
        if (run !== generation || disposed || getScenario() !== "+3m") return;
        monster.update(sampleReveal(0));
        monster.setVisible(true);
        if (cameraOwned) {
          say("Framing the harbour...");
          panel.dataset.state = "framing";
        }
      });
      // Fetch/decode the model and stream the establishing view concurrently.
      const framing = cameraOwned ? fly(CAMERA_START, 4000) : Promise.resolve();
      await Promise.all([preparation, framing]);
      if (run !== generation) return;
      panel.dataset.state = "waiting-scene";
      const waitStatus = reactiveUtils.watch(() => {
        if (!view.stationary || view.interacting) return "Hold the camera still while the scene finishes rendering...";
        if (view.allLayerViews.some(layerView =>
          layerView.visible && layerView.updating && layerView.layer.type === "gaussian-splat")) {
          return "Loading the harbour's 3D scan for this view...";
        }
        if (view.updating || !monster.readyToDraw) return "Finishing the scenery, model and water...";
        return "Scene rendered. Letting the water settle...";
      }, message => say(message), { initial: true });
      try {
        await waitForSceneReady(view, monster, { signal: controller.signal });
      } finally {
        waitStatus.remove();
      }
      if (run !== generation || getScenario() !== "+3m") return;
      say("Offshore reveal. Drag or press V to fly freely.");
      panel.dataset.state = "playing";
      // Framing and resource loading never consume the creature's motion clock.
      const started = performance.now();
      let closingMove = false;
      function tick() {
        if (run !== generation || disposed) return;
        try {
          const elapsed = 4 + (performance.now() - started) / 1000;
          time = Math.min(elapsed, DURATION_S);
          const state = sampleReveal(time);
          monster.update(state, elapsed);
          if (panel.dataset.state !== "holding") {
            if (variant.value === "reveal" && cameraOwned) {
              const camera = sampleCinematicCamera(time);
              if (camera) view.camera = new Camera(camera);
            } else if (variant.value === "walk" && time >= RISE_END_S && !closingMove) {
              closingMove = true;
              if (cameraOwned) fly(CAMERA_END, 11000).catch(fail);
            }
            if (state.done) {
              panel.dataset.state = "holding";
              say("Reveal complete. Explore freely; Reset hides the creature.");
            }
          }
          frame = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      }
      frame = requestAnimationFrame(tick);
    } catch (error) {
      if (run === generation && !disposed) fail(error);
    } finally {
      if (readinessController === controller) readinessController = null;
    }
  }
  const interaction = reactiveUtils.watch(() => view.interacting, interacting => {
    if (interacting) takeOverCamera();
  });
  function keydown(event) {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      !document.getElementById("assumptionsPanel").hidden ||
      document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')) return;
    if (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.closest("input,textarea,select"))) return;
    if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      start();
    } else if (event.key === "Escape" && active) {
      event.preventDefault();
      stop();
    }
  }
  const onPlay = () => start();
  const onReset = () => stop();
  document.addEventListener("keydown", keydown);
  play.addEventListener("click", onPlay);
  reset.addEventListener("click", onReset);
  panel.querySelector("#godzillaClose").addEventListener("click", onClose);
  buttons();
  say("Preparing the model. Select +3m, then Play.");
  loadMonster().then(() => {
    if (!active && !disposed) {
      say(getScenario() === "+3m" ? "Ready. G plays the offshore reveal." : "Select +3m, then press G to reveal.");
    }
  }).catch(error => {
    if (!active && !disposed) fail(error);
  });
  return {
    stop,
    takeOverCamera,
    showControls() {
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    onScenarioChange() {
      if (getScenario() !== "+3m") stop();
      else {
        buttons();
        if (!active && panel.dataset.error !== "true") say("Ready. G plays the offshore reveal.");
      }
    },
    get state() {
      return { active, time, duration: DURATION_S, mode: variant.value, phase: panel.dataset.state };
    },
    dispose() {
      disposed = true;
      stop(false);
      monster?.dispose();
      interaction.remove();
      document.removeEventListener("keydown", keydown);
      panel.remove();
    }
  };
}
