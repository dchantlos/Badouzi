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
