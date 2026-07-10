/* ============================================================
   Badouzi Port Digital Twin — application logic
   ArcGIS Maps SDK for JavaScript 5.1 (@arcgis/core, ES modules)
   ============================================================ */

// ArcGIS dark theme + ES module classes (bundled by Vite).
import "@arcgis/core/assets/esri/themes/dark/main.css";
import WebScene from "@arcgis/core/WebScene.js";
import SceneView from "@arcgis/core/views/SceneView.js";
import Slice from "@arcgis/core/widgets/Slice.js";
import Measurement from "@arcgis/core/widgets/Measurement.js";

// -------- Configuration --------------------------------------------------

// The ArcGIS Online Web Scene item to load.
const WEB_SCENE_ID = "4f053fd887b24a01927d47b766455e3c";

// Heavy 3D data layers exposed as simple on/off toggles.
// `title` must match the layer title inside the Web Scene exactly.
const DATA_LAYERS = [
  { title: "Badouzi (Gaussian Splat)", label: "Badouzi (Gaussian Splat)" },
  { title: "BIM Data", label: "BIM Data" },
  { title: "Point Cloud", label: "Point Cloud" }
];

// Mutually-exclusive storm-surge scenario layers.
// Order defines the segmented control order (Normal first).
const SURGE_LAYERS = [
  { title: "Normal Conditions", value: "0m", label: "Normal" },
  { title: "Above Sea Level 1m", value: "+1m", label: "Surge" },
  { title: "Above Sea Level 2m", value: "+2m", label: "Surge" },
  { title: "Above Sea Level 3m", value: "+3m", label: "Surge" }
];

// -------- Load SDK modules (AMD) -----------------------------------------

/** Show a human-readable failure message on the intro overlay. */
function showOverlayError(message) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    const ring = overlay.querySelector(".loader-ring");
    if (ring) ring.style.animationPlayState = "paused";
    const title = overlay.querySelector(".loader-title");
    const sub = overlay.querySelector(".loader-sub");
    if (title) title.textContent = "Unable to load the scene";
    if (sub) sub.textContent = message;
  }
  const statusText = document.getElementById("statusText");
  if (statusText) statusText.textContent = "Error";
  console.error("[Badouzi Digital Twin]", message);
}

// Surface unexpected runtime errors instead of hanging on the loader.
window.addEventListener("error", function (e) {
  showOverlayError(e.message || "Unexpected error. See the browser console.");
});
window.addEventListener("unhandledrejection", function (e) {
  const reason = e.reason && (e.reason.message || e.reason);
  showOverlayError("" + (reason || "Scene failed to load. See the browser console."));
});

function initApp() {
  // Build the Web Scene from the portal item.
  const scene = new WebScene({
    portalItem: { id: WEB_SCENE_ID }
  });

  const view = new SceneView({
    container: "viewDiv",
    map: scene,
    // Keep the UI clean: only navigation zoom remains, styled via CSS.
    ui: { components: ["zoom"] },
    qualityProfile: "high"
  });

  /**
   * Find a layer anywhere in the scene (top-level or nested in group layers)
   * by matching its title.
   */
  function findLayerByTitle(title) {
    return scene.allLayers.find(function (layer) {
      return layer.title === title;
    });
  }

  /** Build the layer visibility toggle switches. */
  function buildLayerToggles() {
    const container = document.getElementById("layerToggles");

    DATA_LAYERS.forEach(function (cfg) {
      const layer = findLayerByTitle(cfg.title);

      const row = document.createElement("div");
      row.className = "toggle-row" + (layer ? "" : " missing");

      const label = document.createElement("span");
      label.className = "toggle-label";
      label.textContent = layer ? cfg.label : cfg.label + " (unavailable)";

      const switchWrap = document.createElement("label");
      switchWrap.className = "switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = layer ? layer.visible : false;
      input.disabled = !layer;

      const slider = document.createElement("span");
      slider.className = "slider";

      input.addEventListener("change", function () {
        if (layer) {
          layer.visible = input.checked;
        }
      });

      switchWrap.appendChild(input);
      switchWrap.appendChild(slider);
      row.appendChild(label);
      row.appendChild(switchWrap);
      container.appendChild(row);
    });
  }

  /** Build the mutually-exclusive storm-surge segmented control. */
  function buildSurgeControl() {
    const container = document.getElementById("surgeControl");
    const readout = document.getElementById("surgeReadout");

    // Resolve each surge scenario to its actual layer (may be null if absent).
    const resolved = SURGE_LAYERS.map(function (cfg) {
      return { cfg: cfg, layer: findLayerByTitle(cfg.title) };
    });

    /** Turn on exactly one scenario, turn every other off. */
    function activate(activeCfg) {
      resolved.forEach(function (item) {
        if (item.layer) {
          item.layer.visible = item.cfg.title === activeCfg.title;
        }
      });

      // Update button states.
      container.querySelectorAll(".segment").forEach(function (btn) {
        btn.classList.toggle("active", btn.dataset.title === activeCfg.title);
      });

      readout.textContent = activeCfg.title;
    }

    resolved.forEach(function (item, index) {
      const btn = document.createElement("button");
      btn.className = "segment";
      btn.type = "button";
      btn.dataset.title = item.cfg.title;
      if (!item.layer) {
        btn.disabled = true;
        btn.title = item.cfg.title + " is not available in this scene";
      }

      const value = document.createElement("span");
      value.className = "seg-value";
      value.textContent = item.cfg.value;

      const label = document.createElement("span");
      label.className = "seg-label";
      label.textContent = item.cfg.label;

      btn.appendChild(value);
      btn.appendChild(label);
      btn.addEventListener("click", function () {
        if (item.layer) activate(item.cfg);
      });

      container.appendChild(btn);

      // Default the very first scenario (Normal Conditions) as active.
      if (index === 0) {
        activate(item.cfg);
      }
    });
  }

  /** Fade out the cinematic intro overlay. */
  function dismissOverlay() {
    const overlay = document.getElementById("loadingOverlay");
    overlay.classList.add("hidden");
    // Remove from DOM after the fade completes.
    setTimeout(function () {
      overlay.remove();
    }, 1100);
  }

  // Watchdog: if nothing resolves within 30s, tell the user instead of
  // spinning forever (usually a private/unshared item or a network stall).
  let settled = false;
  const watchdog = setTimeout(function () {
    if (!settled) {
      showOverlayError(
        "Still loading after 30s. The Web Scene may be private (requires sign-in) " +
          "or unavailable. Confirm the item is shared publicly."
      );
    }
  }, 30000);

  // Surface the actual load status of the scene item itself.
  scene.load().catch(function (error) {
    settled = true;
    clearTimeout(watchdog);
    showOverlayError(
      "Web Scene could not be loaded: " +
        (error.message || error) +
        ". Verify the item ID and that it is shared with Everyone (public)."
    );
  });

  /**
   * Wire up the Slice and Measurement (area/volume + distance) analysis tools.
   * Only one tool is active at a time; each renders into the top-right host.
   */
  function setupAnalysisTools() {
    const host = document.getElementById("toolContainer");

    const sliceBtn = document.getElementById("toolSlice");
    const volumeBtn = document.getElementById("toolVolume");
    const lineBtn = document.getElementById("toolLine");
    const clearBtn = document.getElementById("toolClear");

    // Slice widget renders into its own node; Measurement into another.
    const sliceNode = document.createElement("div");
    const measureNode = document.createElement("div");

    const slice = new Slice({ view: view, container: sliceNode });
    const measurement = new Measurement({ view: view, container: measureNode });

    let active = null; // "slice" | "measure" | null

    function clearAll() {
      // Reset the slice plane and any active measurement.
      if (slice.viewModel) slice.viewModel.clear();
      measurement.clear();
      if (sliceNode.parentNode) host.removeChild(sliceNode);
      if (measureNode.parentNode) host.removeChild(measureNode);
      active = null;
      [sliceBtn, volumeBtn, lineBtn].forEach(function (b) {
        b.classList.remove("active");
      });
    }

    function showSlice() {
      clearAll();
      host.appendChild(sliceNode);
      active = "slice";
      sliceBtn.classList.add("active");
    }

    function showMeasurement(tool, btn) {
      clearAll();
      host.appendChild(measureNode);
      measurement.activeTool = tool; // "area" (3D area/volume) or "direct-line"
      active = "measure";
      btn.classList.add("active");
    }

    sliceBtn.addEventListener("click", function () {
      active === "slice" ? clearAll() : showSlice();
    });
    volumeBtn.addEventListener("click", function () {
      active === "measure" && measurement.activeTool === "area"
        ? clearAll()
        : showMeasurement("area", volumeBtn);
    });
    lineBtn.addEventListener("click", function () {
      active === "measure" && measurement.activeTool === "direct-line"
        ? clearAll()
        : showMeasurement("direct-line", lineBtn);
    });
    clearBtn.addEventListener("click", clearAll);
  }

  // Wait for the scene view to be fully ready, then wire up the UI.
  view
    .when(function () {
      settled = true;
      clearTimeout(watchdog);
      buildLayerToggles();
      buildSurgeControl();
      setupAnalysisTools();
      dismissOverlay();
    })
    .catch(function (error) {
      settled = true;
      clearTimeout(watchdog);
      showOverlayError(
        error.message || "Please check the Web Scene ID and your connection."
      );
    });
}

initApp();
