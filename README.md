# Badouzi Port Digital Twin

An ArcGIS Maps SDK for JavaScript 5.1 coastal digital twin of Badouzi Port,
Keelung, Taiwan. [Open the app](https://dchantlos.github.io/Badouzi/).

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

## Hidden Godzilla effect

Click the invisible **20 x 20 pixel area at the extreme top-right corner** of
the app. This reveals controls only; it does not play anything. Select **+3m**,
choose **Cinematic rise** or **Slow wade**, and click **Play** or press **G**.
Opening the controls prepares the model in the background without moving the
camera or playing the effect. Neither G nor URL parameters unlock the controls.

Pressing V during any phase hands over the camera without interrupting the
creature. Starting while already flying leaves the pilot's camera in place.
Stay still while the scene settles; the creature remains submerged and unlit
until rendering is ready. Leaving drone mode does not resume a scripted
camera flight.

**Cinematic rise** now has a distinct camera sequence: at the start of charging
(21 seconds), it eases into a close side/three-quarter view, tracks Godzilla
briefly through the charge, then pulls back and rises into an elevated rear
view from 29 to 41 seconds. The close-up holds for only two seconds.
**Slow wade** retains its wider offshore camera. Both variants now use the
baked wading gait throughout the rise and approach. The start is about 40 m
farther offshore, but the final stopping coordinates and 43-second duration
are unchanged. He travels roughly 35 m toward the village while emerging,
instead of rising vertically in place. The opening camera uses a three-quarter
rear angle to make that forward travel visible. The blue charge still waits until
after the unlit rise is complete.

Both variants have stronger neck-led head turns, a deliberate chin lift and
a visible jaw opening during the charge, then settle into gentle breathing.
The head continues a quiet idle after the sequence while the body and camera
hold still.
Dragging, wheel zoom or V relinquishes scripted camera control for the rest
of that playback; the creature keeps moving.

On a cold view, streaming the harbour's Gaussian splat can take tens of seconds.
The status names this stage explicitly. Model preparation overlaps the camera
flight, but playback still waits for fully rendered scenery and two stable
seconds; it never skips that check just to start sooner. Replays reuse the model
and cached scene tiles.

Reset/Esc hides the creature (Esc first belongs to drone navigation while
flying). Home returns home; changing away from +3m removes the effect.
The close button hides the controls and disables G until the corner is
clicked again.

The effect is fictional and excluded from exposure calculations. No hosted
ArcGIS content is modified. See the [effect documentation](./prototypes/godzilla/README.md)
for choreography, rendering, model attribution and the editable Blender recipe.

## Optional water-wake study

The hidden Godzilla controls include **Water wake (preview)**, off by default.
Enable it before Play. Reset before switching it off to compare with the
original ArcGIS water.

This is a local visual experiment: Three.js generates the wake geometry and
normals, and ArcGIS renders it with the existing scene lighting and depth.
The model's actual waterline supplies the disturbance footprint. Bow
disturbances, outward-spreading wake trails and foam remain in world space
and fade after movement stops.

The native water surface, reflections, water-level scenarios and exposure
calculations are not replaced. This is not a fluid solver or a calibrated
wave/flood simulation.

The complete verified pre-wake implementation is saved locally as tag
`godzilla-motion-before-water-wake`, at commit
`bbad6bd20180b26667698cd548d429365ad69e46`. No water experiment has been published.
