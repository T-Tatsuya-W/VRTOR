import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';
import { XRButton } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/XRButton.js';
import { XRHandModelFactory } from 'https://unpkg.com/three@0.161.0/examples/jsm/webxr/XRHandModelFactory.js';

class HandTracker {
  constructor(hand, label) {
    this.hand = hand;
    this.label = label;
    this.listeners = new Map();
    this.state = {
      visible: false,
      wrist: null,
      indexTip: null,
      thumbTip: null,
      pinch: {
        active: false,
        distance: NaN,
        position: null,
        speed: 0
      },
      grab: false,
      open: false
    };

    this.prev = {
      pinchActive: false,
      pinchPosition: new THREE.Vector3(),
      grab: false,
      open: false
    };
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event).delete(handler);
  }

  fire(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => handler(payload));
  }

  update(time, delta) {
    const joints = this.hand.joints ?? null;
    const wrist = joints ? joints['wrist'] : null;
    const indexTip = joints ? joints['index-finger-tip'] : null;
    const thumbTip = joints ? joints['thumb-tip'] : null;
    const fingerNames = [
      'index-finger-tip',
      'middle-finger-tip',
      'ring-finger-tip',
      'pinky-finger-tip'
    ];

    const visible = Boolean(this.hand.visible && wrist);

    let pinchActive = false;
    let pinchDistance = NaN;
    let pinchPosition = null;
    let pinchSpeed = 0;

    if (visible && indexTip && thumbTip) {
      pinchDistance = thumbTip.position.distanceTo(indexTip.position);
      pinchActive = pinchDistance < 0.03;
      if (pinchActive) {
        pinchPosition = new THREE.Vector3()
          .addVectors(indexTip.position, thumbTip.position)
          .multiplyScalar(0.5);
        if (this.prev.pinchActive && delta > 0) {
          pinchSpeed = pinchPosition.distanceTo(this.prev.pinchPosition) / delta;
        }
        this.prev.pinchPosition.copy(pinchPosition);
      }
    }

    let grabActive = false;
    let openActive = false;
    if (visible && wrist) {
      const tipDistances = [];
      for (const name of fingerNames) {
        const joint = joints ? joints[name] : null;
        if (!joint) continue;
        tipDistances.push(joint.position.distanceTo(wrist.position));
      }
      if (tipDistances.length === fingerNames.length) {
        const avg = tipDistances.reduce((sum, value) => sum + value, 0) / tipDistances.length;
        grabActive = avg < 0.07;
        openActive = avg > 0.11;
      }
    }

    this.state = {
      visible,
      wrist,
      indexTip: indexTip ? indexTip.position.clone() : null,
      thumbTip: thumbTip ? thumbTip.position.clone() : null,
      pinch: {
        active: pinchActive,
        distance: pinchDistance,
        position: pinchPosition ? pinchPosition.clone() : null,
        speed: pinchSpeed
      },
      grab: grabActive,
      open: openActive
    };

    const payloadBase = {
      label: this.label,
      hand: this.hand,
      state: this.state,
      time,
      delta
    };

    if (pinchActive) {
      this.fire('pinch', {
        ...payloadBase,
        pinch: this.state.pinch
      });
      if (!this.prev.pinchActive) {
        this.fire('pinchstart', {
          ...payloadBase,
          pinch: this.state.pinch
        });
      }
    } else if (this.prev.pinchActive) {
      this.fire('pinchend', {
        ...payloadBase,
        pinch: { ...this.state.pinch, position: null, speed: 0 }
      });
    }

    if (grabActive && !this.prev.grab) {
      this.fire('grabstart', payloadBase);
    } else if (!grabActive && this.prev.grab) {
      this.fire('grabend', payloadBase);
    }

    if (openActive && !this.prev.open) {
      this.fire('openstart', payloadBase);
    } else if (!openActive && this.prev.open) {
      this.fire('openend', payloadBase);
    }

    this.prev.pinchActive = pinchActive;
    this.prev.grab = grabActive;
    this.prev.open = openActive;
  }

  getLogLines() {
    if (!this.state.visible || !this.state.wrist) {
      return [`${this.label} not tracked`];
    }

    const lines = [
      `${this.label} wrist: (${formatVec3(this.state.wrist.position)})`
    ];

    if (this.state.indexTip) {
      lines.push(`${this.label} index tip: (${formatVec3(this.state.indexTip)})`);
    }

    if (this.state.thumbTip) {
      lines.push(`${this.label} thumb tip: (${formatVec3(this.state.thumbTip)})`);
    }

    if (!Number.isNaN(this.state.pinch.distance)) {
      lines.push(
        `${this.label} pinch: ${this.state.pinch.active ? 'YES' : 'no'} (dist ${this.state.pinch.distance.toFixed(3)})`
      );
    }

    lines.push(`${this.label} grab: ${this.state.grab ? 'YES' : 'no'}`);
    lines.push(`${this.label} open: ${this.state.open ? 'YES' : 'no'}`);

    return lines;
  }
}

function formatVec3(v) {
  return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
}

function createLabelSprite(message) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '120px "Trebuchet MS", "Segoe UI", sans-serif';
  context.fillStyle = '#ffffff';
  context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  context.lineWidth = 10;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeText(message, canvas.width / 2, canvas.height / 2);
  context.fillText(message, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.height / canvas.width;
  const width = 0.8;
  sprite.scale.set(width, width * aspect, 1);
  sprite.renderOrder = 10;
  sprite.userData.texture = texture;
  return sprite;
}

function updatePyramidPosition(pyramid, time) {
  const radius = 0.55;
  const angle = pyramid.userData.baseAngle + time * 0.3;
  const height = Math.sin(time * 1.6 + pyramid.userData.heightPhase) * 0.1;
  pyramid.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101218);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const xrButton = XRButton.createButton(renderer, {
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['hand-tracking']
});

document.getElementById('enter').appendChild(xrButton);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(1, 2, 1);
scene.add(dir);

const grid = new THREE.GridHelper(10, 20, 0x333333, 0x222222);
grid.position.y = 0;
scene.add(grid);

const torusMaterial = new THREE.MeshStandardMaterial({
  color: 0x55ffee,
  emissive: 0x08263a,
  metalness: 0.35,
  roughness: 0.15,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false
});

const torus = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 64, 128), torusMaterial);
torus.position.set(0, 1.5, 0);
torus.rotation.x = Math.PI / 2;
scene.add(torus);

const pyramidGroup = new THREE.Group();
pyramidGroup.position.set(0, 1.5, 0);
scene.add(pyramidGroup);

const pyramidGeo = new THREE.TetrahedronGeometry(0.1);
const pyramidMat = new THREE.MeshStandardMaterial({
  color: 0xffc857,
  metalness: 0.2,
  roughness: 0.4,
  flatShading: true
});

const pyramidCount = 10;
for (let i = 0; i < pyramidCount; i++) {
  const pyramid = new THREE.Mesh(pyramidGeo, pyramidMat.clone());
  pyramid.userData.baseAngle = (i / pyramidCount) * Math.PI * 2;
  pyramid.userData.heightPhase = Math.random() * Math.PI * 2;
  pyramid.userData.spinSpeed = 0.5 + Math.random() * 0.6;
  updatePyramidPosition(pyramid, 0);
  pyramid.rotation.x = Math.PI / 3;
  pyramidGroup.add(pyramid);
}

const torusLabel = createLabelSprite('Portal Hub');
torusLabel.position.set(0, 1.5, 0);
scene.add(torusLabel);

const cubes = new THREE.Group();
scene.add(cubes);
const cubeGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
const cubeMat = new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.1, roughness: 0.6 });
for (let i = 0; i < 30; i++) {
  const m = cubeMat.clone();
  const mesh = new THREE.Mesh(cubeGeo, m);
  mesh.position.set((Math.random() - 0.5) * 4, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 4);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  mesh.userData.baseY = mesh.position.y;
  mesh.userData.phase = Math.random() * Math.PI * 2;
  cubes.add(mesh);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;

const handFactory = new XRHandModelFactory();

const leftHand = renderer.xr.getHand(0);
leftHand.add(handFactory.createHandModel(leftHand, 'spheres'));
leftHand.userData.which = 'L';
scene.add(leftHand);

const rightHand = renderer.xr.getHand(1);
rightHand.add(handFactory.createHandModel(rightHand, 'spheres'));
rightHand.userData.which = 'R';
scene.add(rightHand);

const trackers = [
  new HandTracker(leftHand, 'L'),
  new HandTracker(rightHand, 'R')
];

const pinchTelemetry = {
  L: null,
  R: null
};

trackers.forEach((tracker) => {
  tracker.on('pinch', ({ label, pinch }) => {
    pinchTelemetry[label] = {
      position: pinch.position ? pinch.position.clone() : null,
      speed: pinch.speed
    };
  });

  tracker.on('pinchend', ({ label }) => {
    pinchTelemetry[label] = null;
  });
});

const logCanvas = document.createElement('canvas');
logCanvas.width = 768;
logCanvas.height = 384;
const ctx = logCanvas.getContext('2d');

const logTex = new THREE.CanvasTexture(logCanvas);
logTex.minFilter = THREE.LinearFilter;

const logMat = new THREE.MeshBasicMaterial({ map: logTex, transparent: true });
const logPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), logMat);
logPanel.position.set(0, 1.6, -1.2);
scene.add(logPanel);

function writeLog(lines) {
  ctx.clearRect(0, 0, logCanvas.width, logCanvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, logCanvas.width, logCanvas.height);
  ctx.fillStyle = '#00ffcc';
  ctx.font = '28px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, 20, y);
    y += 36;
  }
  logTex.needsUpdate = true;
}

window.addEventListener('error', (e) => {
  try {
    writeLog([`Error: ${e.message}`]);
  } catch (_) {
    // ignore canvas write errors
  }
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  const t = elapsed;
  for (const m of cubes.children) {
    m.rotation.y += 0.01;
    m.position.y = m.userData.baseY + Math.sin(t * 0.8 + m.userData.phase) * 0.08;
  }

  torus.rotation.y += delta * 0.3;

  pyramidGroup.children.forEach((pyramid) => {
    updatePyramidPosition(pyramid, elapsed);
    pyramid.rotation.y += delta * pyramid.userData.spinSpeed;
    pyramid.rotation.x += delta * 0.4;
  });

  controls.update();

  trackers.forEach((tracker) => tracker.update(elapsed, delta));

  const lines = ['WebXR Hand Log – Spring Refresh', '—'];
  trackers.forEach((tracker) => {
    lines.push(...tracker.getLogLines());
  });

  const activePinches = Object.entries(pinchTelemetry).filter(([, data]) => data);
  if (activePinches.length > 0) {
    lines.push('—', 'Pinch telemetry');
    activePinches.forEach(([label, data]) => {
      if (!data || !data.position) return;
      lines.push(
        `${label} pinch pos: (${formatVec3(data.position)})`,
        `${label} pinch speed: ${data.speed.toFixed(3)} m/s`
      );
    });
  }

  writeLog(lines);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
