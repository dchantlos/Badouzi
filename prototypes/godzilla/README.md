# Godzilla easter egg

The effect is included in the production build but is opt-in and lazy-loaded.
The source directory retains its prototype name alongside the developer-only
gait study and Blender recipe. No hosted feature service or Web Scene is edited.

Click the invisible 20 x 20 pixel area at the extreme top-right of the app to
reveal the controls. Choose **+3m**, select **Cinematic rise** or **Slow wade**,
then click **Play** or press **G**. G does nothing before unlocking, and the old
`?godzilla=` parameters no longer activate anything. Closing the controls
hides the effect and disables G until the corner is clicked again.

**Esc** resets, restoring the previous camera only if the effect still owns
it. **Home view** hides the effect and returns home. Changing to another
scenario also removes it. Dragging, wheel zoom or pressing **V** takes over the camera
without interrupting the creature. Starting while drone mode is active skips
automatic camera flights. Exiting drone mode never resumes those flights.
While flying, Esc belongs to navigation first; the Reset button remains
available after freeing the cursor with X.

After the establishing camera move, the model stays submerged and the motion
clock pauses while the scene renders. Playback requires the view to be ready,
stationary, visible, and not updating; the model's layer view must also be ready.
These conditions must remain stable for two seconds. New tile requests,
camera movement, or lighting/weather changes restart that settling interval.
The panel reports the wait; Esc, Home, and scenario changes cancel it.
If rendering cannot settle within 60 seconds, the effect stays hidden and shows
a retry message rather than starting against an unfinished scene.

Opening the hidden controls prepares the model without playing it or moving
the camera. On Play, any remaining preparation overlaps the establishing
camera flight instead of running before it. The status distinguishes loading
the harbour's Gaussian splat from final rendering and settling. A cold scan
view can still take tens of seconds; render readiness is not bypassed.

Both modes use the same rigged mesh and root Three.js dependency. Run `npm ci`
at the repository root; no nested install is required. Switching variants while
idle reuses the loaded model. The selector is disabled during playback.

The cinematic option uses a 110 m model, initially fully submerged, with a
14-second eased rise. About 55 m of the final silhouette is above the surface.
He faces the village from the beginning of the rise and approaches it, rather
than facing the offshore camera. Both options share this orientation and path.
The lower body stays hidden. At 21 seconds, when charging begins, the cinematic
camera moves into a close side/three-quarter shot over six seconds, tracks the
creature for only two seconds, then immediately continues the move. From 29 to 41 seconds it pulls back and rises
into an elevated rear view, holding that composition before the 43-second end.
The camera and its aim point move together, so the head and dorsal plates stay
framed as Godzilla approaches the village.
As the shoulders clear the water, the arms lift forward and outward, the elbows
flex, and the wrists follow with a small delayed motion. Five slow, alternating
strokes accompany the approach, then settle when the reveal finishes.
The four neck joints lead deliberate head turns and a stronger chin lift;
the skull follows with a slight lag instead of pivoting as a rigid block.
The jaw closes slightly, opens visibly with the charge, then relaxes into
quiet breathing after the main sequence ends. The head stays aimed generally
toward the village; there is no exaggerated head shaking or talking-mouth loop.
Head-only frames re-skin only neck/head-influenced vertices, leaving the frozen
body, arms, feet, placement and final camera untouched. Idle breathing uses a
lighter 15 Hz pose cadence; the reveal retains 30 Hz head poses.
Both variants walk forward from 5 to 43 seconds, including throughout the
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

Godzilla Minus One - Godzillasaurus by
[Draco](https://sketchfab.com/Draco120),
[source](https://sketchfab.com/3d-models/godzilla-minus-one-godzillasaurus-b1f63bb4b5c64ad1b8988f0ca48e3138),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The derivative converts specular/glossiness to metallic/roughness materials,
resizes textures to 2048 px, adds a baked wading gait, and applies runtime arm
motion and dorsal emission. The original GLB is untouched.

## Walking option

Select **Slow wade** in the unlocked controls, select +3m, and press G or Play.
The same rise, route and glow timing are used, but the camera keeps the
restrained offshore approach rather than the cinematic close-up and rear
pullback. The approach evaluates a baked 6.4-second skeletal gait.
Five cycles are synchronized with the travelled distance, ending with both
feet planted. The camera can still be taken over manually.

The native ArcGIS glTF importer does not play skeletal clips automatically.
In both modes, Three.js evaluates the gait, arm and head joints on the CPU and updates the positions,
normals and tangents of a native ArcGIS Mesh. Vertex correspondence is checked
before playback. ArcGIS remains responsible for drawing, depth, lighting and
water reflections; no separate WebGL renderer is left running.
Both modes play the baked gait; they differ in camera choreography.
Arm and head offsets are applied to a fresh base pose each frame, so replaying
cannot accumulate joint rotations.

The standalone [gait study](./walk-viewer.html) shows the whole body on a ground
grid, with root travel synchronized to the feet and a tracking camera. It is
for reviewing the gait, not a second version of the port.

Both options now require animated-mesh updates and should be reviewed on the
presentation machine before selecting one for a demo.
Neither option includes physically simulated wakes or an underwater terrain model.
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

## Optional wake experiment

**Water wake (preview)** is opt-in, and its setting is locked during playback.
Reset before changing it. The default-off state does not load the wake.
Once loaded, switching it off hides the cached geometry and stops its updates;
closing the controls releases it.
The saved pre-wake baseline is the local tag `godzilla-motion-before-water-wake`
(`bbad6bd20180b26667698cd548d429365ad69e46`).

Three.js supplies the plane geometry and recalculated normals. A native
ArcGIS Mesh renders the displaced crests and alpha-blended foam, rather than
running a second renderer that cannot automatically reflect ArcGIS content.
The existing WaterSymbol3DLayer, native model reflections, lighting and Glow
remain unchanged.

Triangle/water-plane intersections of the animated body locate the contact
footprint. Motion and emergence drive a bounded history of disturbances,
including a bow crest, two divergent trails and fading foam. The grid is
anchored at the original stopping point, so old disturbances stay behind
instead of moving as a texture attached to the creature. It has 10,125 vertices,
updates at up to 15 Hz, and its trails fade over 18 seconds after their emission.
Reset, Home, scenario changes and closing the controls remove the effect.
The overlay is excluded from inspection and wheel-zoom picking.

This is a procedural visual study, not fluid dynamics. It does not deform
the underlying ArcGIS water or re-simulate its reflections/refraction, and it
does not contribute to the exposure calculation. Keep it off for the saved
baseline presentation until its appearance and performance have been reviewed.
The local CPU benchmark measured roughly 13 ms per wake update, including
contact sampling; this is additional work and not a GPU/frame-rate guarantee.

The controller, Three.js and model are loaded only after the corner click,
not during normal app startup. Vite emits the single animated GLB with the production
`/Badouzi/` base. The standalone gait-study HTML and Blender recipe are not
production entry points and are not linked from the public controls.
