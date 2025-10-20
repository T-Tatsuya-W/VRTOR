# Quest VR Scene

A lightweight WebXR scene designed for Meta Quest headsets (Quest 3 tested) and suitable for hosting on GitHub Pages. The scene lets you walk around, shows animated controller and hand models, and streams pose data to an in-world floating text panel.

## Getting started

1. Serve the site locally (for example with Python):

   ```bash
   python3 -m http.server
   ```

2. Open the page in a WebXR capable browser (Quest Browser / Oculus Browser works best).
3. Click **Enter VR** and grant headset permissions.

## Features

- Smooth locomotion driven by the left controller joystick.
- Real-time logging of headset, controller, and hand positions to a floating canvas in the scene.
- Basic lighting, a ground pad, and a floating cube placeholder prop.

## Deploying to GitHub Pages

Commit the site to your repository’s `main` branch and enable GitHub Pages with the **GitHub Actions** or **main branch / root** option. The site is completely static, so no build step is required.
