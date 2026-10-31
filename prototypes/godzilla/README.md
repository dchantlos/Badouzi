# Godzilla scene effect

The effect is included in the production build but is opt-in and lazy-loaded.
The source directory retains its prototype name alongside the developer-only
gait study and Blender recipe. No hosted feature service or Web Scene is edited.

Click **Godzilla** in the left panel, below Drone mode. Its standalone creature-icon
button selects **+3m** and opens the controls; it never starts playback or moves
the camera. **Cinematic rise** is the only sequence; there is no sequence selector.
Click the **Play** triangle icon or press **G** to prepare the encounter behind
the coastal-emergency popup. The Play and Reset icon buttons retain accessible
names, visible keyboard focus and shortcut tooltips.
Once **Proceed to Encounter** enables, click it to start. The Three.js wake is automatic. There is no hidden corner trigger,
wake checkbox or renderer chooser. URL parameters do not autoplay the effect.
Closing the controls hides the effect, releases its resources and returns
focus to the Godzilla button.

**Esc** resets, restoring the previous camera only if the effect still owns
it. **Home view** hides the effect and returns home. Changing to another
scenario also removes it. Dragging, wheel zoom or pressing **V** takes over the camera
without interrupting the creature. Starting while drone mode is active skips
automatic camera flights. Exiting drone mode never resumes those flights.
While flying, Esc belongs to navigation first; the Reset button remains
available after freeing the cursor with X.

After the establishing camera move, the model stays submerged and the motion
clock pauses while the scene renders behind the popup. Playback requires the view to be ready,
stationary, visible, and not updating; the model's layer view and the water
shader must also be ready.
These conditions must remain stable for two seconds before Proceed enables.
While loading, the amber button keeps its full colour and reads **Please wait...**;
it cannot start playback. Once ready, it changes to **Proceed to Encounter**.
Readiness continues to be observed while awaiting the user's click; new tile
requests, camera movement, or lighting/weather changes disable Proceed and
restart that settling interval. Time spent reading the popup never advances
the motion clock, and a ready popup does not time out waiting for the user.
Esc or the popup's close button cancels. Home and scenario changes also cancel.
If rendering cannot settle within 60 seconds, the effect stays hidden and shows
a retry action in the popup rather than starting against an unfinished scene.

The encounter popup recreates the supplied coastal-emergency design in HTML,
CSS and SVG: amber headline/action, teal radar sweep, pulsing red monster
contact, and no radar caption. It leaves SceneView visible and rendering
behind a modal backdrop. Native dialogs contain keyboard focus and block
camera-navigation shortcuts while open. `prefers-reduced-motion` disables
the sweep and pulse. The header and action remain available while shorter
screens scroll the popup body.

Opening the controls prepares the model without playing it or moving
the camera. On Play, water-shader preparation and any remaining model work
overlap the establishing camera flight. The popup and panel share short
monster-themed loading lines, rotating every four seconds. The rotation stops
when ready, cancelled, closed or failed; actual errors and retry instructions
remain explicit. Popup status text is enlarged for presentation readability;
the left-panel status remains compact. A cold scan view can still take tens of seconds; the humorous
copy never bypasses render readiness or implies measured progress.
The panel has no ready-state message. Its status line also disappears after the
walk while the head/jaw loop continues; loading messages and errors remain visible.

## Eye-to-harbour sight lines

The **Godzilla Sight Lines** toggle enables only after the 43-second approach
has finished, preserving the complete cinematic sequence. Activating it clears
interactive analysis tools, leaves Drone mode if needed, and uses the supplied
closer rear-oblique camera reference rather than an automatically widened view.
Turning it off keeps the current camera.
Dragging, wheel zoom or Drone mode can take over without a later camera recapture.

Two native `LineOfSightAnalysis` objects supply exactly eight rays, four per eye.
The verified `bip_eye_l_95` and `bip_eye_r_96` rig joints identify each skinned
eye surface. Origins sit 8 cm beyond its outermost surface and use the same
scale, rotation, translation and local geographic frame as the rendered mesh.
This avoids starting inside the opaque eyeballs. Origins refresh at 10 Hz
while the existing head animation continues. The observer `feature` references
the creature's native Graphic for the SDK's near-surface adjustment; it is not
a blanket geometry exclusion. A head turn can still obstruct a ray, and no
visibility result is overridden to force a clear line.

Target data reuses the app's loaded inventory and scene metadata:

- Fish Market, Exhibition Center and Bike Station: their BIM extent centres,
  0.5 m above each model's maximum elevation.
- Three fixed roof points picked directly from the Gaussian splat in the supplied
  building-block reference: the central tower, neighbouring apartment block and
  pale apartment block, each with 0.5 m vertical clearance.
- Two retained mapped quay locations, Bollards 235 and 156, at 1.5 m above sampled
  ground. The former leftmost rays to Bollards 260, 251 and 230 are replaced by the
  roof targets. Out-of-area records remain excluded without altering the inventory
  or exposure totals.

The points are projected into the scene reference before selection. The camera
was matched against the three BIM marker positions in the supplied screenshot
at a 55-degree field of view (heading 187.633742, tilt 68.5625, elevation 230.220 m).
Missing required buildings or retained quay records, incomplete source queries,
unsupported coordinates or duplicate locations fail explicitly; the app never
silently draws fewer than eight rays. Target positions and source records are not modified by
the moving eye origins. This is a fictional visual demonstration, not a
survey-grade visibility assessment.

The toggle can cancel its own pending preparation. Reset, Home, scenario changes,
Clear, another analysis tool or closing Godzilla removes both analyses and
invalidates pending work. Drone navigation preserves the read-only eye rays for
exploration. The rays and their camera never affect exposure calculations or
save changes to the hosted scene.

## Creature choreography

The effect uses a rigged mesh and the root Three.js dependency. Run `npm ci`
at the repository root; no nested install is required. Replays reuse the loaded model.

The cinematic sequence uses a 110 m model, initially fully submerged, with a
14-second eased rise. About 55 m of the final silhouette is above the surface.
He faces the village from the beginning of the rise and approaches it, rather
than facing the offshore camera.
The lower body stays hidden. At 21 seconds, when charging begins, the cinematic
camera moves into a close side/three-quarter shot over six seconds, tracks the
creature for only two seconds, then immediately continues the move. From 29 to 41 seconds it pulls back and rises
into an elevated rear view, holding that composition before the 43-second end.
The camera and its aim point move together, so the head and dorsal plates stay
framed as Godzilla approaches the village.
As the shoulders clear the water, the arms lift forward and outward, the elbows
flex, and the wrists follow with a small delayed motion. Five slow, alternating
strokes accompany the approach, then settle when the reveal finishes.
The four neck joints lead broad head turns and pronounced chin lifts;
the skull follows with a slight lag instead of pivoting as a rigid block.
The jaw repeatedly opens and closes during the approach, with its largest
opening near the cinematic close-up. At the end of the walk, a 16-second loop
alternates left/right looks, neck lifts and large jaw openings. Quintic
transitions ease into the loop and across its seams; subtle breathing repeats
on compatible periods. This adds visible movement, not audio or an attack.
Head-only frames re-skin only neck/head-influenced vertices, leaving the frozen
body, arms, feet, placement and final camera untouched. Both walking and idle
head poses run at 30 Hz, including after the water wake has finished fading.
Godzilla walks forward from 5 to 43 seconds, including throughout the
14-second rise. Five stride-matched gait cycles cover roughly 100 metres,
with gentle four-second acceleration and deceleration ramps. The starting
point is about 40 metres farther offshore; the previous stopping point
(13557768.969325766, 2893638.189589372 in Web Mercator) is unchanged.
He advances roughly 35 metres while emerging, rather than rising in place.
The establishing camera shifts offshore with the new start and uses a
three-quarter rear angle so the forward travel is visible. The close-up,
rear pullback and final view still follow the creature.
Any initial rendering wait adds to wall-clock time without consuming the
43-second sequence. There is no sound, shake or particle effect.
The effect is not included in asset exposure or land sampling.

## Blue dorsal charge-up

The entire rise is uncharged, with no added blue color or glow. Walking starts
with the rise at 5 seconds; the rise ends at 19 seconds and charging begins
two seconds later, moving upward:
tail at 21-27 seconds, middle back at 23-29 seconds, and upper plates at
25-31 seconds. The slightly brighter cyan-blue glow then holds until reset.
This adds no beam, sound, flashing, or attack.

The supplied model uses one body material. Its 31 dorsal UV islands are split
into three material regions without adding, removing, or moving any vertices
or triangles. Skin, face, hands and teeth retain their original materials.
Each plate region uses `MeshMaterialMetallicRoughness.emissiveColor`,
`emissiveTexture`, and `emissiveStrength`. A grayscale copy of the diffuse
atlas preserves surface detail without tinting the blue emission green.
Uncharged regions explicitly have a black emissive color and zero strength.
The charged color is RGB (64, 200, 255), with peak emissive strength 7.5,
25% higher than the earlier preview.
The source texture and GLB are not modified.

This is rendered by the ArcGIS Maps SDK for JavaScript 5.1.12, using the
existing `view.environment.lighting.glow` (`Glow`, intensity 0.85).
The global glow setting and the asset-marker emission are not changed.
The standalone gait study remains an animation review; use the Badouzi
app to see the SDK's lighting and glow.

## Model and credit

The panel's **Credits** link opens a separate dialog with the
[Badouzi GitHub repository](https://github.com/dchantlos/Badouzi), model source links,
licenses, adaptations, Three.js and ArcGIS rendering, the fictional-effect disclaimer
and the V/Drone-mode reminder. The repository's [credits](../../README.md#credits-and-source)
also cover harbour data, weather, UI/navigation references and build tooling.
Closing the dialog returns focus to Credits without resetting a playing encounter.
Routine wake-preparation messages and inline
attribution are omitted from the control panel; actual wake failures remain visible.

Godzilla Minus One - Godzillasaurus by
[Draco](https://sketchfab.com/Draco120),
[source](https://sketchfab.com/3d-models/godzilla-minus-one-godzillasaurus-b1f63bb4b5c64ad1b8988f0ca48e3138),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The derivative converts specular/glossiness to metallic/roughness materials,
resizes textures to 2048 px, adds a baked wading gait, and applies runtime arm,
neck, head and jaw motion and dorsal emission. The original GLB is untouched.

## Rigged walking animation

The cinematic approach evaluates a baked 6.4-second skeletal gait.
Five cycles are synchronized with the travelled distance, ending with both
feet planted. The camera can still be taken over manually.

The native ArcGIS glTF importer does not play skeletal clips automatically.
Three.js evaluates the gait, arm and head joints on the CPU and updates the positions,
normals and tangents of a native ArcGIS Mesh. Vertex correspondence is checked
before playback. ArcGIS remains responsible for drawing the creature, its
depth, lighting and water reflections. Only the water wake uses the additional
Three.js renderer, sharing the existing WebGL context rather than a second canvas.
Arm and head offsets are applied to a fresh base pose each frame, so replaying
cannot accumulate joint rotations.

The standalone [gait study](./walk-viewer.html) shows the whole body on a ground
grid, with root travel synchronized to the feet and a tracking camera. It is
for reviewing the gait, not a second version of the port.

The effect requires animated-mesh updates and should be reviewed on the
presentation machine before a demo.
It does not include physically simulated wakes or an underwater terrain model.
Arm/head motion and dorsal emission are applied in the app; previously exported
GLBs and videos are unchanged.

### Blender recipe

`build_walk.py` imports the supplied compatible model into Blender 4.2, adds
two-bone IK controls and a weighted stance/swing gait, then verifies ankle
targets, planted-foot drift and the loop seam before exporting.
It saves an editable `.blend` with IK controls and a separate baked GLB.
The output directory must be new; existing deliverables are not overwritten.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python prototypes/godzilla/build_walk.py \
  -- /absolute/path/to/compatible-model.glb /absolute/path/to/new-output
```

## Verification

```sh
node --test prototypes/godzilla/*.test.js
npm test
npm run build
```

## Automatic Three.js wake

The wake loads automatically on Play.
There is no native-mesh fallback renderer or public wake setting. Reset hides
and clears the wake for replay; closing Godzilla releases its render node,
geometry, material and owned GPU targets. Home and scenario changes also stop it.

An ArcGIS `RenderNode` at `final-color` shares the scene's WebGL context with
Three.js. Owned render targets copy native scene color and depth before the
shader draws; only color attachment 0 is returned. Native depth and the extra
glow attachment remain untouched. The renderer never resizes the ArcGIS canvas
or calls `forceContextLoss`. Shared-state handling normalizes inherited image
upload flags before Three initializes and reports shader/WebGL failures explicitly.

Triangle/water-plane intersections of the animated body locate the contact
footprint. Shared forcing updates at up to 15 Hz; the GPU evaluates the bounded
wave history, displaced crests and normals on a 15,756-vertex grid. Wave time
continues between forcing updates. Bow waves, two divergent trails, emergence
ripples and broken foam stay in world space and fade over 18 seconds after
emission, instead of travelling as a texture carpet attached to the creature.
After the trail expires, the expensive shader pass stops.

The fragment shader distorts already-rendered native water/reflections using
wave normals, rejects foreground geometry through scene depth, and shades
foam with native sunlight. This is screen-space distortion, not a new planar
reflection of all ArcGIS objects or a full fluid simulation. Positive crests
use geometry; troughs are represented optically above the unchanged native water.
The effect does not participate in map picking or exposure calculations.

The SDK's RenderNode API is experimental. Review the effect on presentation
hardware before publishing: full-frame copies and GPU wave evaluation add work.
A local CPU-only benchmark measured about 0.2 ms per shader wake update,
including contact sampling, versus about 13 ms for the removed native preview.
That is not a GPU or frame-rate guarantee. Browser checks also compare GPU
height/foam against the CPU reference and verify pass-through pixels, depth,
glow, resizing and shader-failure recovery.

The saved local rollback tags remain `godzilla-motion-before-water-wake`
(`bbad6bd20180b26667698cd548d429365ad69e46`) and `godzilla-native-wake-preview`
(`bda1590fb34e4bed58f679086fb852ca0aa72652`). The latter retains the removed
native renderer for historical comparison, not as an app option.

The controller, Three.js and model load only after the Godzilla button is used,
not during normal app startup. Vite emits the single animated GLB with the production
`/Badouzi/` base. The standalone gait-study HTML and Blender recipe are not
production entry points and are not linked from the public controls.
