# Badouzi Fishing Harbour Digital Twin

An interactive 3D digital twin of Badouzi Fishing Harbour, Keelung, Taiwan,
built with ArcGIS Maps SDK for JavaScript 5.1 and Three.js.

[Open the app](https://dchantlos.github.io/Badouzi/) ·
[Source code](https://github.com/dchantlos/Badouzi)

- Explore the harbour's Gaussian-splat, BIM and point-cloud layers.
- Compare illustrative tidal scenarios, mapped asset exposure and assumed replacement values.
- Show field-collected assets in green and expand their captured details for presentations.
- Use interactive line-of-sight analysis, smooth zoom and first-person Drone navigation.
- Run a cinematic Godzilla encounter with an automatic Three.js water wake, animated
  head/neck/jaw movement and eight eye-to-harbour sight lines.

The header uses the shared **Develop with ArcGIS** branding and Dev logo,
with a distinct letter-spaced harbour title and **Keelung, Taiwan** underneath.
The logo and title link to [ArcGIS Developers](https://developers.arcgis.com/)
in a new tab, leaving the digital twin open.

The higher-water scenarios are illustrative what-if views, not flood forecasts.
Asset values are assumed replacement values for mapped assets, not predicted
damage or economic losses. Current weather provides context only.

## Local development

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm test
npm run build
npm run preview -- --host 127.0.0.1 --base /Badouzi/
```

GitHub Pages builds and tests on Node 20. Production assets use the `/Badouzi/`
base. A push to `master` runs the [deployment workflow](./.github/workflows/deploy.yml).

## Presenting field-collected assets

In **0m Normal**, turn on **Field-collected assets** under Data Layers. It is
off by default and uses the same cached bollard/streetlight records as the
tidal scenarios, with the same glyphs, callouts and glowing orb materials in
green. BIM models are not part of this field-data layer. Green means an
inventory record, not a flood-risk or safety classification.

The toggle is unavailable during +1m/+2m/+3m; green markers are hidden so the
existing orange/red exposure symbology stays unambiguous. Returning to 0m
restores an explicitly enabled field-data layer. The preference is not saved
across page reloads. Failed or unplaceable records are reported, with a retry
action; missing elevations are never replaced by zero.

Click a field or exposure marker to inspect its asset ID, captured attributes
(such as condition or installation/inspection dates), source and current
scenario context. Use the **Expand** icon in that card's header for a large-text
presentation window. Drag its header, or focus the header and use arrow keys,
to reposition it. The map remains interactive, so selecting another asset
updates the same expanded window. **Restore** or **Esc** returns it to the left
panel; Close dismisses it and restores the weather. The exposure summary on
the right is unchanged.

## Line of sight

Select **Line of sight** in the left-panel tools. Click the scene to place an
observer, then click one or more targets. **Finish placing** or **Esc** stops
adding points while keeping the result; **Add targets** resumes placement.
Drag the points to edit them, or right-click a target to remove it.
**Start over** creates a fresh analysis. **Clear**, the tool's close button,
switching to Slice/Distance, or entering Drone mode removes it.
During Godzilla playback, selecting Line of sight takes over the camera without
stopping the creature. Esc finishes point placement rather than resetting
Godzilla. Clear active analysis tools before starting a new encounter.

Green sight lines indicate visible paths and red indicates obstructions.
Gray/unavailable results are not treated as visible; keep both the observer
and targets in view. The summary distinguishes visible, blocked, calculating
and unavailable targets.

The tool uses the SDK's native `LineOfSightAnalysis` and interactive analysis
view, with no new widget dependency. Version 5.1 supports Gaussian-splat
obstructions ([release notes](https://developers.arcgis.com/javascript/latest/v5-1/#3d-analysis-support-for-gaussian-splat-layers)).
Results depend on visible layers and the currently loaded level of 3D detail,
so changing zoom or scene content can change visibility. This is a local visual
analysis, not a survey-grade clearance certification; no results are saved to
the hosted Web Scene or included in the exposure totals.

## Smooth first-person drone mode

Press **V**, or click **Drone mode**, to enter at the current camera without
changing the view or field of view. Press **V** again to exit where you are.
The short controls reminder stays in the left dock; there are no flight
metrics or overlays across the scene.

| Control | Action |
| --- | --- |
| W / S | Smooth forward / backward flight, following the direction you look |
| A / D | Strafe left / right |
| Q / E or Left / Right arrows | Turn |
| I / K or Up / Down arrows | Climb / descend |
| Mouse | Look around when captured |
| Wheel over the scene | Adjust cruise speed, not zoom |
| X | Free the cursor to inspect; drag with left/right mouse to look. Press again to capture |
| Esc | Free a captured cursor; press again to exit flight |

Flight uses the controls and 0.32-second velocity easing from
[dchantlos/3dgs](https://github.com/dchantlos/3dgs/blob/a4e161f7195f27bdc60bdd0958b0ac1bc7d885c8/src/flight.js),
plus eased mouse look and frame-independent translation. Cruise starts at 28 m/s
and is adjustable from 10 to 1500 m/s. No lighting, shadow, atmosphere or glow
settings are changed. This is keyboard/mouse visual exploration, not navigation.

Flight clears active analysis tools. Home, Slice, Distance, Clear, and native
camera flights exit drone mode. Shortcuts do not intercept text fields,
selectors or the assumptions panel. Losing focus stops movement.
If the browser cannot capture the mouse, a visible message explains the
drag-to-look fallback.

## Mouse-wheel zoom

Outside Drone mode, the wheel smoothly dollies toward or away from the surface
under the cursor. Wheel notches accumulate into one eased movement instead of
restarting a large zoom step. Trackpad and line/page wheel units are normalized.
When the pointer is over the sky, the view centre is used instead.

Dragging, Home/native camera flights, entering Drone mode, or losing focus
cancels the remaining zoom. Scrolling over the side panels stays normal.
The camera field of view, lighting and visual quality are unchanged.
Inside Drone mode the wheel still adjusts cruise speed, not zoom.

## Godzilla scene effect

Click the **Godzilla** button with its creature icon in the left panel, below Drone mode.
It selects **+3m** and opens the controls without moving the camera or starting
playback. **Cinematic rise** is the only sequence; there is no sequence selector.
Click the **Play** triangle icon or press **G**. Play and Reset are icon buttons
with accessible names and shortcut tooltips.
A coastal-emergency popup appears immediately while the camera, model,
water and scenery prepare behind it. Its teal radar tracks a pulsing red
contact, with no caption beneath the radar.

**Proceed to Encounter** enables only after two seconds of stable rendering.
The popup stays open and the creature remains submerged and unlit until that
button is clicked. New loading or lighting changes disable it again until the
scene settles. Esc or the popup's close button cancels; loading errors offer a
retry. Reduced-motion preferences stop the radar animation.

The model prepares in the background. The Three.js water wake runs
automatically; there is no renderer chooser or hidden corner trigger.

Pressing V during any phase hands over the camera without interrupting the
creature. Starting while already flying leaves the pilot's camera in place.
Stay still while the scene settles; the creature remains submerged and unlit
until rendering is ready. Leaving drone mode does not resume a scripted
camera flight.

**Cinematic rise** uses this camera sequence: at the start of charging
(21 seconds), it eases into a close side/three-quarter view, tracks Godzilla
briefly through the charge, then pulls back and rises into an elevated rear
view from 29 to 41 seconds. The close-up holds for only two seconds.
Godzilla uses the baked wading gait throughout the rise and approach. The start is about 40 m
farther offshore, but the final stopping coordinates and 43-second duration
are unchanged. He travels roughly 35 m toward the village while emerging,
instead of rising vertically in place. The opening camera uses a three-quarter
rear angle to make that forward travel visible. The blue charge still waits until
after the unlit rise is complete.

Godzilla has broad, neck-led head turns, chin lifts and repeated mouth
openings while walking. After the 43-second approach, a continuous 16-second
head/neck/jaw loop alternates looking left and right with large mouth openings.
The transition and loop boundaries are eased; the body, feet, stopping point
and final camera stay still. Head poses continue at 30 Hz.
Dragging, wheel zoom or V relinquishes scripted camera control for the rest
of that playback; the creature keeps moving.

On a cold view, streaming the harbour's Gaussian splat can take tens of seconds.
The popup and panel rotate short monster-themed loading lines while model
preparation overlaps the camera flight. Playback still waits for fully rendered scenery and two stable
seconds; it never skips that check just to start sooner. Replays reuse the model
and cached scene tiles. Actual errors remain explicit. After walking, the
completion message disappears while the idle animation continues.

Reset/Esc hides the creature (Esc first belongs to drone navigation while
flying). Home returns home; changing away from +3m removes the effect.
The close button hides the controls and releases the effect. Use the left-panel
Godzilla button to reopen it.

The **Credits** link opens the model source, author, CC BY 4.0 attribution,
Three.js/MIT credit, rendering details and Drone-mode reminder in a separate
popup. Closing Credits does not stop the encounter.

### Godzilla's harbour sight lines

After the walk finishes, **Godzilla Sight Lines** becomes available in the
Godzilla controls. Select it to show four native ArcGIS sight lines from each
animated eye and fly to the closer rear-oblique camera from the supplied reference.
The targets are the Fish Market, Exhibition Center and Bike Station, three roof
points in the pictured waterfront building block, and the retained quay locations
at Bollards 235 and 156. The three former leftmost quay lines are no longer used.
These are representative visual targets, not surveyed sighting stations.

The origins follow his idle head movement just outside the rendered eye
surfaces while the harbour targets remain fixed. Native green/red/gray
visibility colours apply; geometry crossing a ray can still obstruct it.
Deselect the button to remove the lines without moving the camera. Drone mode
can explore the displayed fan; selecting a different analysis tool, Clear,
Reset, Home, leaving +3m or closing Godzilla removes it.

The effect is fictional and excluded from exposure calculations. No hosted
ArcGIS content is modified. See the [effect documentation](./prototypes/godzilla/README.md)
for choreography, rendering, model attribution and the editable Blender recipe.

## Three.js water wake

Godzilla uses one automatic wake implementation: a Three.js shader integrated
into the ArcGIS rendering pass. The earlier native-mesh wake preview has been
removed from the app.

The model's actual waterline and movement drive displaced crests, a bow wave,
two trailing wakes and broken foam. Disturbances remain anchored in the water
and fade over 18 seconds after emission. The shader uses the native camera and
depth to protect foreground geometry, and distorts the already-rendered ArcGIS
water/reflections rather than trying to reflect a separate Three.js scene.

The native water layer, lighting, glow, water-level scenarios and exposure
calculations remain intact. This is a procedural visual effect, not a fluid
solver or a calibrated wave/flood simulation. A wake failure is reported
explicitly; the original scene water remains available.

Historical rollback checkpoints remain in Git history:
[pre-wake movement](https://github.com/dchantlos/Badouzi/commit/bbad6bd20180b26667698cd548d429365ad69e46)
and the [native wake preview](https://github.com/dchantlos/Badouzi/commit/bda1590fb34e4bed58f679086fb852ca0aa72652).
The current app uses only the automatic Three.js wake.

## Credits and source

The in-app **Credits** popup includes the [GitHub repository](https://github.com/dchantlos/Badouzi),
model attribution, rendering libraries and the fictional-effect disclaimer.

- **Harbour rendering and analysis:** [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/)
  by Esri renders the scene, native analyses, creature, lighting and water reflections.
- **Water wake and skeletal animation:** [Three.js](https://threejs.org/),
  used under its [MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE).
  The wake is a procedural visual effect, not a physical fluid simulation.
- **Creature model:** [Godzilla Minus One - Godzillasaurus](https://sketchfab.com/3d-models/godzilla-minus-one-godzillasaurus-b1f63bb4b5c64ad1b8988f0ca48e3138)
  by [Draco](https://sketchfab.com/Draco120), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  The app uses a derivative with adapted materials and textures, a baked wading
  animation, runtime arm/head/neck/jaw movement and dorsal glow. The original supplied
  model remains unchanged. See the [model and effect documentation](./prototypes/godzilla/README.md).
- **Harbour data:** the configured [Badouzi Web Scene](https://www.arcgis.com/home/item.html?id=4f053fd887b24a01927d47b766455e3c)
  and its linked layers. Bollards and streetlights were collected with
  [ArcGIS Field Maps](https://www.esri.com/en-us/arcgis/products/arcgis-field-maps/overview).
  Source-layer metadata and scene attribution identify the data providers; the app does not modify hosted content.
- **Weather context:** [Open-Meteo](https://open-meteo.com/). Weather is not used to
  predict water levels or exposure.
- **UI and navigation references:** the shared Dev branding and dark-panel design from
  [construction-timelapse](https://github.com/dchantlos/construction-timelapse), and
  flight controls adapted from [3dgs](https://github.com/dchantlos/3dgs).
- **Development and build tooling:** [Vite](https://vite.dev/),
  used under its [MIT license](https://github.com/vitejs/vite/blob/main/LICENSE).

Third-party models, libraries, data and services retain their respective licenses
and terms. Godzilla is a fictional visual demonstration and is excluded from all
asset exposure calculations.
