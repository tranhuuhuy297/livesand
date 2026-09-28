# Hardware setup guide

Everything you need to turn a box of sand, a LiDAR iPhone and a projector into an AR sandbox. For the software steps
(relay, iPhone app, pairing) see the [README](../README.md#build-the-real-sandbox) and [ios/README.md](../ios/README.md).

## Overview

```
        projector      iPhone (LiDAR, camera down)
            \  |  /   |
             \ | /    |        1 to 1.5 m
              \|/     |
      ┌───────────────────────┐
      │   sand, 8 to 10 cm    │  box ~100 x 75 cm, 15 to 20 cm deep
      └───────────────────────┘
```

Both devices look straight down at the box, as close to each other as practical. The laptop can sit anywhere on the
same Wi-Fi; it drives the projector over HDMI.

## The box

- **Size:** about 100 × 75 cm inside. The 4:3 shape matches the LiDAR image and the 256 × 192 simulation grid, so no
  resolution is wasted. Anything from 60 × 45 cm to 120 × 90 cm works.
- **Depth:** 15–20 cm walls, filled with 8–10 cm of sand. Calibration assumes you dig at most 12 cm below the flat sand
  and pile at most 20 cm above it (both adjustable).
- **Build:** an under-bed storage box is the quickest option. A wooden frame (four planks on a plywood base) is sturdier;
  a light-coloured or white inner surface keeps stray projection clean.

## Sand

- **Fine, light-coloured play sand** (white or pale beige) shows the projected colours best. Dark or coarse sand dulls
  the image.
- **Quantity:** 100 × 75 cm × 10 cm is 75 litres, roughly 110 kg of dry sand. 8 cm is plenty to start.
- **Slightly damp sand holds steep walls and channels.** Mist it with a spray bottle; it should clump when squeezed,
  not drip. Re-mist when it dries out.

## The projector

- **Brightness matters more than resolution.** A dim room plus a 720p or 1080p projector works. The simulation grid is
  256 × 192, so 4K buys nothing.
- **Throw distance:** `distance = throw ratio × image width`. A typical 1.2:1 projector needs 1.2 m to cover a 1 m
  wide box; a short-throw (0.5:1) projector needs only 0.5 m. The image must cover the whole box; the keystone step
  trims the rest.
- **Pointing down:** most projectors are built to project forward. Use a tripod or bracket that tilts the projector to
  face down, or a shelf above the box. If the image comes out mirrored or upside down, use the projector's own
  ceiling / rear projection menu to flip it.
- **Turn off the projector's built-in keystone.** LiveSand's corner-pin (calibration step 4) does the correction and
  keeps the pixels square on the sand.
- Leave space for heat: do not wrap the projector in a closed box.

## The iPhone

- **Height:** 1–1.5 m above the sand, camera pointing straight down. At 1 m the LiDAR's field of view covers about
  1.15 × 0.86 m, just right for a 100 × 75 cm box. LiDAR is most accurate within about 2 m.
- **Orientation:** landscape, long edge along the box's long edge. Any rotation works (the corners calibration maps it),
  but aligned edges waste the fewest pixels.
- **Position:** next to the projector lens. Close together, the phone sees roughly what the projector lights, and your
  hand's shadow falls where the rain is.
- **Rigid mount:** a camera boom arm, microphone stand or shelf bracket. Any wobble shows up as terrain noise.
- **Power:** keep it on a charger. Streaming keeps the screen awake and the phone warm; if iOS throttles it, the frame
  rate drops but streaming continues.

## Calibration tips

The wizard opens automatically the first time depth arrives. Press **C** in projector mode to run it again.

1. **Corners.** Click the four *inside* corners of the box on the depth image, in order: top-left, top-right,
   bottom-right, bottom-left. "Top" is the edge where you want the top of the projected image. Click a few pixels
   inside the walls rather than on them. Handles can be dragged or nudged with the arrow keys.
2. **Flat sand.** Level the sand with a straight board, keep hands and heads out of view, then capture. The median of
   about 15 frames becomes the per-cell reference, which also cancels a phone that is not perfectly level.
3. **Relief.** Enter the inside width of the box in cm: it sets how many height units one centimetre of sand is.
   The dig and pile limits set the colour range (defaults 12 cm and 20 cm). Anything more than 5 cm above the pile limit
   counts as a hand and makes rain.
4. **Projector.** The projector shows a grid. Drag its four corners onto the four corners of the box.
5. **Save.** The calibration is stored in this browser. Moving the phone means redoing steps 1–2; moving the projector
   means redoing step 4.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Terrain shimmers or looks noisy | Tighten the phone mount; make sure nothing vibrates (projector fan on the same arm). |
| Terrain is tilted or has a slope that is not there | Re-capture the flat sand (step 2) after levelling it. |
| Holding a hand over the sand does not rain | Hold it higher: it must be more than 5 cm above the pile limit (about 25 cm above flat sand with the defaults). |
| Tall piles start raining by themselves | Raise the pile limit in step 3, or keep piles below it. |
| Projected colours do not line up with the sand | Redo step 4. If the offset changes across the box, move the phone closer to the projector lens. |
| Low frame rate or many dropped frames | Weak Wi-Fi: move the router closer, use 5 GHz, or connect the laptop by Ethernet. |
| The phone cannot connect | See the troubleshooting table in [ios/README.md](../ios/README.md#troubleshooting). |
