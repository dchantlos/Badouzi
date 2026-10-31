import Color from "@arcgis/core/Color.js";
import Graphic from "@arcgis/core/Graphic.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Point from "@arcgis/core/geometry/Point.js";
import { isValidElevation } from "./exposure.js";

export function prepareFieldAssets(inputs) {
  if (inputs.length !== 2 || new Set(inputs.map(input => input.id)).size !== 2) {
    throw new Error("Both field-data inputs are required");
  }
  const items = [];
  const issues = [];
  let unplaced = 0;
  const keys = new Set();
  for (const input of inputs) {
    if (!["bollards", "streetlights"].includes(input.id)) {
      throw new Error("Field data must use the bollard and streetlight inputs");
    }
    if (input.status !== "ok") {
      issues.push(input.reason || `${input.label} unavailable`);
      continue;
    }
    if (!Array.isArray(input.items)) throw new Error(`Missing field records for ${input.label}`);
    for (const item of input.items) {
      if (!item.key || !item.sr || ![item.x, item.y, item.groundZ].every(isValidElevation)) {
        unplaced++;
        continue;
      }
      if (keys.has(item.key)) throw new Error(`Duplicate field record: ${item.key}`);
      keys.add(item.key);
      items.push(item);
    }
  }
  if (unplaced) issues.push(`${unplaced} record${unplaced === 1 ? "" : "s"} could not be placed`);
  return { items, issues };
}

export function createFieldAssetLayer({ view, container, loadInputs, makeSymbol, onDataChanged, onError }) {
  const layer = new GraphicsLayer({
    id: "field-collected-assets",
    title: "Field-collected assets",
    visible: false,
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });
  view.map.add(layer);
  const row = document.createElement("div");
  row.className = "toggle-row field-assets-row";
  row.innerHTML = `
    <label class="toggle-label" for="fieldAssetsToggle">Field-collected assets
      <small>0m Normal only</small>
    </label>
    <label class="switch">
      <input id="fieldAssetsToggle" type="checkbox" aria-label="Show field-collected assets"
        aria-describedby="fieldAssetsStatus">
      <span class="slider"></span>
    </label>`;
  const status = document.createElement("p");
  status.id = "fieldAssetsStatus";
  status.className = "field-assets-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const retry = document.createElement("button");
  retry.id = "fieldAssetsRetry";
  retry.className = "field-assets-retry";
  retry.type = "button";
  retry.textContent = "Retry field data";
  retry.hidden = true;
  container.append(row, status, retry);
  const input = row.querySelector("input");
  let requested = false;
  let normal = true;
  let loading = false;
  let loaded = false;
  let complete = false;
  let generation = 0;
  let items = new Map();
  let message = "";
  let problem = false;
  function sync() {
    input.checked = normal && requested;
    input.disabled = !normal;
    input.title = normal ? "Show field records, not flood risk" : "Select 0m Normal to show field data";
    row.classList.toggle("unavailable", !normal);
    row.setAttribute("aria-busy", String(loading));
    layer.visible = normal && requested && loaded && items.size > 0;
    status.hidden = !normal || !requested;
    status.dataset.error = String(problem);
    status.textContent = loading ? "Loading field-collected assets..." : message;
    retry.hidden = !normal || !requested || !problem || loading;
  }
  async function load() {
    const run = ++generation;
    loading = true;
    loaded = false;
    problem = false;
    layer.removeAll();
    sync();
    try {
      const inputs = await loadInputs();
      if (run !== generation) return;
      const prepared = prepareFieldAssets(inputs);
      const green = Color.fromString(getComputedStyle(document.documentElement).getPropertyValue("--mint").trim());
      if (!green) throw new Error("The field-data marker colour is unavailable");
      const graphics = prepared.items.map(item => new Graphic({
        geometry: new Point({ x: item.x, y: item.y, z: item.groundZ, spatialReference: item.sr }),
        symbol: makeSymbol(green.toRgb(), item.layerTitle),
        attributes: { exposureKey: item.key }
      }));
      items = new Map(prepared.items.map(item => [item.key, item]));
      layer.addMany(graphics);
      loaded = true;
      complete = prepared.issues.length === 0;
      problem = !complete;
      message = items.size ? `${items.size} field records loaded. Green is inventory, not flood risk.`
        : "No field records are available to display.";
      if (problem) {
        message += ` ${prepared.issues.join("; ")}.`;
        onError(new Error(prepared.issues.join("; ")));
      }
      onDataChanged();
    } catch (error) {
      if (run !== generation) return;
      complete = false;
      problem = true;
      message = `Field data unavailable: ${error.message}. Retry to load it.`;
      onError(error);
    } finally {
      if (run === generation) {
        loading = false;
        sync();
      }
    }
  }
  input.addEventListener("change", () => {
    requested = input.checked;
    if (!requested) {
      generation++;
      loading = false;
      sync();
    } else if (complete) sync();
    else load();
  });
  retry.addEventListener("click", load);
  sync();
  return {
    layer,
    getItem(key) { return items.get(key); },
    setScenario(value) {
      normal = value === "0m";
      if (!normal) {
        generation++;
        loading = false;
      }
      sync();
      if (normal && requested && !complete && !loading) load();
    }
  };
}
