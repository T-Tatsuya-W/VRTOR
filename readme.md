# VRTOR WebXR Hand Tracking Demo

This repository hosts a lightweight WebXR experience for experimenting with Quest 3 hand tracking. The scene is built with Three.js and can be deployed as static assets (e.g., GitHub Pages).

## Current Build Highlights

- Modular file layout (`index.html`, `styles.css`, `main.js`) so markup, styling, and logic can evolve independently.
- Minimal Three.js scene with floating cubes, grid floor, and XR-compatible lighting.
- Stationary transparent centerpiece torus framing orbiting tetrahedral markers and billboarded text callouts that always face the viewer and stay readable through the glass.
- WebXR hand tracking powered by `XRHandModelFactory`, rendered as lightweight sphere hands.
- Gesture manager that detects pinches, open-hand, and grab poses, exposing hooks for future interactions.
- Pinch telemetry logger that captures pinch position and speed whenever a pinch is held, mirrored on the in-world hand panels.
- Dedicated left- and right-hand log panels plus a system board that can be repositioned, rotated, or scaled by grabbing with both hands.
- Tuned grab detection window for more comfortable activation without sacrificing open-hand recognition.
- Desktop fallback instructions so the scene is explorable without a headset.

## How to Try It

1. Serve the repository root (for example with `npx http-server .`) or visit the GitHub Pages deployment associated with this repo.
2. On Quest 3, enter VR mode and enable hand tracking when prompted. On desktop, use the mouse to orbit the scene.
3. Watch the floating log panels for joint positions, gesture state, and pinch telemetry. Runtime errors will flow to the system board alongside any general notices.
4. To rearrange the panel cluster in VR, grab with both hands and move them to translate, twist to rotate, or vary the distance between hands to scale.

## Deployment Notes

- JavaScript dependencies are loaded directly from the `unpkg.com` CDN—no bundling is required.
- Adjust styling in `styles.css`, scene or gesture logic in `main.js`, and markup/imports in `index.html` before redeploying via your preferred static hosting workflow.
