import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import Camera from "@arcgis/core/Camera.js";
import { CAMERA_START, DURATION_S, sampleReveal } from "./timeline.js";
import { sampleCinematicCamera } from "./cinematic-camera.js";
import { createGodzillaDialogs } from "./dialogs.js";
import "./preview.css";

export function setupGodzilla({
  view, getScenario, closeInspector, tools, isManualNavigationActive, getSightTargets, prepareSightView, onClose
}) {
  const panel = document.createElement("section");
  panel.className = "dock-section godzilla-preview";
  panel.id = "godzillaPreview";
  panel.dataset.state = "idle";
  panel.innerHTML = `
    <h2 class="dock-section-title">Godzilla
      <button class="godzilla-close" id="godzillaClose" type="button" aria-label="Hide Godzilla controls">&times;</button>
    </h2>
    <p class="godzilla-wake-status" role="status" hidden></p>
    <p class="godzilla-status" role="status">Select +3m, then press G to reveal.</p>
    <div class="tool-grid">
      <button class="tool-btn godzilla-action-button" id="godzillaPlay" type="button"
        aria-label="Play Godzilla" aria-keyshortcuts="G" title="Play (G)">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M8 5v14l11-7Z"/>
        </svg>
      </button>
      <button class="tool-btn godzilla-action-button" id="godzillaReset" type="button"
        aria-label="Reset Godzilla" aria-keyshortcuts="Escape" title="Reset (Esc)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M3 11a9 9 0 1 1 2.4 7.2M3 4v7h7"/>
        </svg>
      </button>
    </div>
    <button class="tool-btn godzilla-sight-button" id="godzillaSight" type="button"
      aria-pressed="false" title="Available after Godzilla finishes walking" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <span>Godzilla Sight Lines</span>
    </button>
    <p class="godzilla-sight-status" role="status" hidden></p>
    <button class="godzilla-credits-link" type="button" aria-haspopup="dialog" aria-controls="godzillaCredits">Credits</button>`;
  document.querySelector(".dock-panel").append(panel);
  const play = panel.querySelector("#godzillaPlay");
  const reset = panel.querySelector("#godzillaReset");
  const status = panel.querySelector(".godzilla-status");
  const wakeStatus = panel.querySelector(".godzilla-wake-status");
  const sightButton = panel.querySelector("#godzillaSight");
  const sightStatus = panel.querySelector(".godzilla-sight-status");
  let monster;
  let loading;
  let wake;
  let wakeLoading;
  let active = false;
  let generation = 0;
  let frame = 0;
  let savedCamera;
  let cameraOwned = false;
  let disposed = false;
  let time = 0;
  let readinessController;
  let eyeSight;
  let eyeLoading = false;
  let eyeRequest = 0;
  let eyeController;
  let sightCameraRequested = false;
  const dialogs = createGodzillaDialogs({ onCancel: () => stop(), onRetry: () => start(), onStatus: say });

  function say(message, error = false) {
    status.hidden = !message;
    status.textContent = message;
    panel.dataset.error = String(error);
  }
  function buttons() {
    play.disabled = getScenario() !== "+3m" || active;
    reset.disabled = !active;
    sightButton.disabled = !active || time < DURATION_S;
    sightButton.setAttribute("aria-pressed", String(!!eyeSight || eyeLoading));
    sightButton.classList.toggle("active", !!eyeSight || eyeLoading);
    sightButton.setAttribute("aria-busy", String(eyeLoading));
    sightButton.title = !active || time < DURATION_S ? "Available after Godzilla finishes walking"
      : eyeLoading ? "Cancel harbour sight-line preparation"
        : eyeSight ? `Hide sight lines to ${eyeSight.targets.map(site => site.name).join(", ")}`
        : "Show eight eye-to-harbour sight lines from the closer rear-oblique view";
  }
  function wakeMessage(message, error = false) {
    wakeStatus.hidden = !message;
    wakeStatus.textContent = message;
    wakeStatus.dataset.error = String(error);
    dialogs.setWarning(error ? message : "");
  }
  function failWake(error) {
    console.warn("[Badouzi Digital Twin] Water wake:", error);
    wake?.dispose();
    wake = null;
    wakeMessage(`Wake unavailable: ${error.message}. Original scene water remains. Reset and Play to retry.`, true);
    buttons();
  }
  function loadWake() {
    if (wake) return Promise.resolve(wake);
    wakeMessage("");
    wakeLoading ??= import("./three-water-wake.js")
      .then(({ createThreeWaterWake }) => createThreeWaterWake(view, {
        onError(error) {
          if (!disposed) failWake(error);
        }
      }))
      .then(loaded => {
        if (disposed) {
          loaded.dispose();
          return null;
        }
        wake = loaded;
        wakeMessage("");
        return wake;
      })
      .finally(() => {
        wakeLoading = null;
        if (!disposed) buttons();
      });
    buttons();
    return wakeLoading;
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
    const preparing = dialogs.encounterOpen;
    stop(false);
    monster?.dispose();
    monster = null;
    loading = null;
    say(`Godzilla unavailable: ${error.message}. Press G to retry.`, true);
    if (preparing) dialogs.showError(error);
  }
  function fly(camera, duration) {
    return view.goTo(camera, { duration, easing: "ease-in-out" }).catch(error => {
      if (error.name !== "AbortError") throw error;
    });
  }
  function takeOverCamera() {
    const owned = cameraOwned;
    cameraOwned = false;
    sightCameraRequested = false;
    savedCamera = null;
    if (owned) view.animation?.stop();
  }
  function sightMessage(message, error = false) {
    sightStatus.hidden = !message;
    sightStatus.textContent = message;
    sightStatus.dataset.error = String(error);
  }
  function clearSightLines() {
    eyeRequest++;
    eyeController?.abort();
    eyeController = null;
    eyeSight?.dispose();
    eyeSight = null;
    eyeLoading = false;
    if (sightCameraRequested) takeOverCamera();
    sightMessage("");
    buttons();
  }
  function failSightLines(error) {
    console.warn("[Badouzi Digital Twin] Godzilla sight lines:", error);
    clearSightLines();
    sightMessage(`Sight lines unavailable: ${error.message}. Try the button again.`, true);
  }
  async function toggleSightLines() {
    if (eyeSight || eyeLoading) {
      clearSightLines();
      return;
    }
    if (!active || disposed || time < DURATION_S) return;
    prepareSightView();
    takeOverCamera();
    const request = ++eyeRequest;
    const controller = new AbortController();
    eyeController = controller;
    eyeLoading = true;
    sightCameraRequested = true;
    cameraOwned = true;
    sightMessage("Finding eight harbour landmarks...");
    buttons();
    try {
      const [module, data] = await Promise.all([import("./eye-sightlines.js"), getSightTargets()]);
      if (request !== eyeRequest || controller.signal.aborted || disposed) return;
      const targets = module.selectHarbourTargets(data, view.spatialReference);
      const loaded = await module.createEyeSightLines(view, monster, targets, { signal: controller.signal });
      if (request !== eyeRequest || controller.signal.aborted || disposed) {
        loaded.dispose();
        return;
      }
      eyeSight = loaded;
      sightMessage("");
      if (cameraOwned && sightCameraRequested) await fly(loaded.cameraTarget(), 2000);
    } catch (error) {
      if (request === eyeRequest && !controller.signal.aborted && !disposed) failSightLines(error);
    } finally {
      if (request === eyeRequest) {
        eyeLoading = false;
        sightCameraRequested = false;
        cameraOwned = false;
        buttons();
      }
    }
  }
  function stop(restore = true) {
    const run = ++generation;
    active = false;
    clearSightLines();
    cancelAnimationFrame(frame);
    readinessController?.abort();
    readinessController = null;
    const camera = restore && cameraOwned && !isManualNavigationActive() ? savedCamera : null;
    if (cameraOwned) view.animation?.stop();
    cameraOwned = false;
    monster?.setVisible(false);
    wake?.setVisible(false);
    wake?.reset();
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
    say(getScenario() === "+3m" ? "" : "Select +3m, then press G to reveal.");
    buttons();
    dialogs.closeEncounter();
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
    panel.dataset.state = "loading";
    buttons();
    try {
      dialogs.showEncounter();
      const water = loadWake().catch(error => {
        if (!disposed) failWake(error);
      });
      const preparation = Promise.all([loadMonster(), water]).then(() => {
        if (run !== generation || disposed || getScenario() !== "+3m") return;
        monster.update(sampleReveal(0));
        monster.setVisible(true);
        if (wake) {
          wake.reset();
          wake.setVisible(true);
        }
        if (cameraOwned) {
          panel.dataset.state = "framing";
        }
      });
      // Fetch/decode the model and stream the establishing view concurrently.
      const framing = cameraOwned ? fly(CAMERA_START, 4000) : Promise.resolve();
      await Promise.all([preparation, framing]);
      if (run !== generation) return;
      panel.dataset.state = "waiting-scene";
      const sceneContent = {
        get readyToDraw() { return monster.readyToDraw && (!wake || wake.readyToDraw); }
      };
      await dialogs.waitForProceed(view, sceneContent, {
        signal: controller.signal,
        onReadyChange(ready) {
          panel.dataset.state = ready ? "ready" : "waiting-scene";
        }
      });
      if (run !== generation || getScenario() !== "+3m") return;
      dialogs.closeEncounter();
      say("Offshore reveal. Drag or press V to fly freely.");
      panel.dataset.state = "playing";
      // Framing and resource loading never consume the creature's motion clock.
      const started = performance.now();
      function tick() {
        if (run !== generation || disposed) return;
        try {
          const elapsed = 4 + (performance.now() - started) / 1000;
          time = Math.min(elapsed, DURATION_S);
          const state = sampleReveal(time);
          monster.update(state, elapsed);
          if (eyeSight) {
            try { eyeSight.update(elapsed); }
            catch (error) { failSightLines(error); }
          }
          if (wake) {
            try {
              wake.update(state, elapsed, () => monster.getWaterContact());
            } catch (error) {
              failWake(error);
            }
          }
          if (panel.dataset.state !== "holding") {
            if (cameraOwned) {
              const camera = sampleCinematicCamera(time);
              if (camera) view.camera = new Camera(camera);
            }
            if (state.done) {
              panel.dataset.state = "holding";
              say("");
              buttons();
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
  sightButton.addEventListener("click", toggleSightLines);
  panel.querySelector(".godzilla-credits-link").addEventListener("click", () => dialogs.showCredits());
  panel.querySelector("#godzillaClose").addEventListener("click", onClose);
  buttons();
  say("Finding monster...");
  loadMonster().then(() => {
    if (!active && !disposed) {
      say(getScenario() === "+3m" ? "" : "Select +3m, then press G to reveal.");
    }
  }).catch(error => {
    if (!active && !disposed) fail(error);
  });
  return {
    stop,
    takeOverCamera,
    clearSightLines,
    showControls() {
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      (play.disabled ? reset : play).focus({ preventScroll: true });
    },
    onScenarioChange() {
      if (getScenario() !== "+3m") stop();
      else {
        buttons();
        if (!active && panel.dataset.error !== "true") say("");
      }
    },
    get state() {
      return { active, time, duration: DURATION_S, mode: "reveal", phase: panel.dataset.state };
    },
    dispose() {
      disposed = true;
      stop(false);
      monster?.dispose();
      wake?.dispose();
      interaction.remove();
      document.removeEventListener("keydown", keydown);
      dialogs.dispose();
      panel.remove();
    }
  };
}
