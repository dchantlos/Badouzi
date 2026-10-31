import { isSceneReady, observeSceneReadiness } from "./scene-ready.js";

const LOADING_LINES = [
  "Finding monster...",
  "Following suspiciously large bubbles...",
  "Checking for extra-large footprints...",
  "Politely requesting a dramatic entrance...",
  "Untangling the tail...",
  "Reminding Godzilla this is a demo...",
  "Practising the intimidating stare...",
  "Making room for the big guy..."
];

export function createGodzillaDialogs({ onCancel, onRetry, onStatus }) {
  const encounter = document.createElement("dialog");
  encounter.id = "godzillaEncounter";
  encounter.className = "godzilla-dialog encounter-dialog";
  encounter.setAttribute("aria-labelledby", "encounterTitle");
  encounter.setAttribute("aria-describedby", "encounterDescription");
  encounter.innerHTML = `
    <header class="godzilla-dialog-header">
      <p class="encounter-kicker">Coastal emergency message</p>
      <button class="godzilla-dialog-close" type="button" aria-label="Cancel encounter" title="Cancel encounter">&times;</button>
    </header>
    <div class="encounter-body">
      <div class="encounter-copy">
        <p class="encounter-anomaly">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 3 38 35H2Z M20 13v10 M20 28v1"/>
          </svg>
          Offshore anomaly
        </p>
        <h2 id="encounterTitle">Unidentified <span>life form</span></h2>
        <p id="encounterDescription">Something large is moving<br>beneath the harbour.</p>
      </div>
      <div class="encounter-radar">
        <div class="encounter-sweep" aria-hidden="true"></div>
        <svg viewBox="0 0 320 320" role="img" aria-label="Teal radar tracking a red offshore contact">
          <g class="encounter-radar-grid">
            <circle cx="160" cy="160" r="132"/>
            <circle cx="160" cy="160" r="86"/>
            <circle cx="160" cy="160" r="42"/>
            <path d="M10 160h300 M160 10v300"/>
            <path class="encounter-radar-brackets" d="M8 42V8h34 M278 8h34v34 M312 278v34h-34 M42 312H8v-34"/>
          </g>
          <g class="encounter-contact">
            <circle class="encounter-contact-halo" cx="230" cy="105" r="10"/>
            <circle class="encounter-contact-halo encounter-contact-echo" cx="230" cy="105" r="10"/>
            <circle class="encounter-contact-core" cx="230" cy="105" r="8"/>
          </g>
        </svg>
      </div>
    </div>
    <footer class="encounter-footer">
      <p class="encounter-status" id="encounterStatus" role="status">${LOADING_LINES[0]}</p>
      <p class="encounter-warning" role="alert" hidden></p>
      <button class="encounter-proceed" id="encounterProceed" type="button" disabled>Please wait...</button>
    </footer>`;
  const credits = document.createElement("dialog");
  credits.id = "godzillaCredits";
  credits.className = "godzilla-dialog credits-dialog";
  credits.setAttribute("aria-labelledby", "godzillaCreditsTitle");
  credits.innerHTML = `
    <header class="godzilla-dialog-header">
      <h2 id="godzillaCreditsTitle">Godzilla credits</h2>
      <button class="godzilla-dialog-close" type="button" aria-label="Close credits">&times;</button>
    </header>
    <div class="godzilla-credits-body">
      <section>
        <h3 class="kicker">Project source</h3>
        <p><a href="https://github.com/dchantlos/Badouzi" target="_blank" rel="noopener noreferrer">Badouzi Fishing Harbour on GitHub</a></p>
        <p>App source code, documentation and project credits.</p>
      </section>
      <section>
        <h3 class="kicker">Model</h3>
        <p><a href="https://sketchfab.com/3d-models/godzilla-minus-one-godzillasaurus-b1f63bb4b5c64ad1b8988f0ca48e3138" target="_blank" rel="noopener noreferrer">Godzilla Minus One - Godzillasaurus</a>
          by <a href="https://sketchfab.com/Draco120" target="_blank" rel="noopener noreferrer">Draco</a>.</p>
        <p>Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.
          Adapted materials, textures, animation and dorsal glow. Original model unchanged.</p>
      </section>
      <section>
        <h3 class="kicker">Rendering</h3>
        <p><a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">Three.js</a>
          powers the water/wake shader and skeletal animation
          (<a href="https://github.com/mrdoob/three.js/blob/dev/LICENSE" target="_blank" rel="noopener noreferrer">MIT license</a>).</p>
        <p><a href="https://developers.arcgis.com/javascript/" target="_blank" rel="noopener noreferrer">ArcGIS Maps SDK for JavaScript</a>
          renders the harbour, creature, lighting and native reflections.</p>
      </section>
      <section>
        <h3 class="kicker">About this effect</h3>
        <p>Fictional entertainment; excluded from exposure analysis. The wake is a visual effect, not a flood or fluid simulation.</p>
        <p>Press <kbd>V</kbd> for Drone mode without stopping the creature.</p>
      </section>
    </div>`;
  document.body.append(encounter, credits);
  for (const dialog of [encounter, credits]) {
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button:not(:disabled), a[href]")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  const proceed = encounter.querySelector("#encounterProceed");
  const status = encounter.querySelector("#encounterStatus");
  const warning = encounter.querySelector(".encounter-warning");
  let loadingTimer;
  function stopLoadingLines() {
    clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
  const closeEncounter = () => {
    stopLoadingLines();
    if (encounter.open) encounter.close();
  };
  const closeCredits = () => { if (credits.open) credits.close(); };
  function message(text) {
    status.textContent = text;
    onStatus(text);
  }
  function show(dialog) {
    if (dialog.open) return;
    if (document.pointerLockElement) document.exitPointerLock();
    dialog.showModal();
  }
  function setReady(ready) {
    stopLoadingLines();
    encounter.dataset.state = ready ? "ready" : "loading";
    proceed.disabled = !ready;
    proceed.textContent = ready ? "Proceed to Encounter" : "Please wait...";
    if (ready) message("Monster located. Ready when you are.");
    else {
      let index = 0;
      message(LOADING_LINES[index]);
      loadingTimer = setInterval(() => {
        index = (index + 1) % LOADING_LINES.length;
        message(LOADING_LINES[index]);
      }, 4000);
    }
  }
  encounter.addEventListener("cancel", event => { event.preventDefault(); onCancel(); });
  encounter.querySelector(".godzilla-dialog-close").addEventListener("click", onCancel);
  proceed.addEventListener("click", () => {
    if (encounter.dataset.state !== "error") return;
    closeEncounter();
    onRetry();
  });
  credits.addEventListener("cancel", event => { event.preventDefault(); closeCredits(); });
  credits.querySelector(".godzilla-dialog-close").addEventListener("click", closeCredits);
  return {
    get encounterOpen() { return encounter.open; },
    showEncounter() {
      closeCredits();
      setReady(false);
      warning.hidden = true;
      warning.textContent = "";
      show(encounter);
    },
    waitForProceed(view, model, { signal, onReadyChange }) {
      return new Promise((resolve, reject) => {
        let readiness;
        function finish(error) {
          readiness?.remove();
          proceed.removeEventListener("click", accept);
          if (error) reject(error);
          else resolve();
        }
        function accept() {
          if (readiness.ready && isSceneReady(view, model)) finish();
        }
        proceed.addEventListener("click", accept);
        readiness = observeSceneReadiness(view, model, {
          signal,
          onChange(ready) {
            setReady(ready);
            onReadyChange(ready);
          },
          onError: finish
        });
      });
    },
    showError(error) {
      stopLoadingLines();
      encounter.dataset.state = "error";
      status.textContent = `Unable to establish visual contact. ${error.message}`;
      proceed.textContent = "Retry encounter";
      proceed.disabled = false;
      show(encounter);
    },
    setWarning(message) {
      warning.textContent = message;
      warning.hidden = !message;
    },
    showCredits() { show(credits); },
    closeEncounter,
    dispose() {
      closeEncounter();
      closeCredits();
      encounter.remove();
      credits.remove();
    }
  };
}
