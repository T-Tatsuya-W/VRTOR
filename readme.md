# VRTOR WebXR Hand Tracking Demo

This repository hosts a lightweight WebXR experience that can be deployed to GitHub Pages for testing Quest 3 hand tracking. The current build focuses on verifying a refreshed deployment that includes:

- Minimal Three.js scene with floating cubes and grid for spatial reference.
- WebXR hand tracking support with lightweight sphere hands supplied by `XRHandModelFactory`.
- On-screen log panel that reports wrist, index, and thumb joint data plus pinch detection state.
- Desktop fallback instructions so the scene is explorable without a headset.

## How to Try It

1. Serve the `index.html` file or visit the GitHub Pages deployment associated with this repo.
2. On Quest 3, enter VR mode and enable hand tracking when prompted. On desktop, use the mouse to orbit the scene.
3. Watch the log panel in front of you for joint positions and pinch state updates. Any runtime errors will also appear there.

## Deployment Notes

- The log panel title now reads **"WebXR Hand Log – Spring Refresh"** to mark this deployment.
- JavaScript dependencies are pulled directly from the `unpkg.com` CDN so no bundling step is required.
- To make local edits, update `index.html`, then redeploy through your preferred static hosting workflow.

