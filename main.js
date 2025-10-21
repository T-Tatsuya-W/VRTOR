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
        grabActive = avg < 0.09;
        openActive = avg > 0.11;
      }
    }

    const wristPosition = wrist ? wrist.position.clone() : null;

    this.state = {
      visible,
      wrist: wristPosition,
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
      `${this.label} wrist: (${formatVec3(this.state.wrist)})`
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
      if (this.state.pinch.active && this.state.pinch.speed > 0) {
        lines.push(`${this.label} pinch speed: ${this.state.pinch.speed.toFixed(3)} m/s`);
      }
    }

    lines.push(`${this.label} grab: ${this.state.grab ? 'YES' : 'no'}`);
    lines.push(`${this.label} open: ${this.state.open ? 'YES' : 'no'}`);

    return lines;
  }
}

function formatVec3(v) {
  return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
}

function createLabelSprite(message, options = {}) {
  const {
    width = 0.8,
    fontSize = 120,
    color = '#ffffff',
    strokeStyle = 'rgba(0, 0, 0, 0.35)',
    lineWidth = 10,
    renderOrder = 10,
    depthTest = true
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;
  context.fillStyle = color;
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
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
    depthTest,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  const aspect = canvas.height / canvas.width;
  sprite.scale.set(width, width * aspect, 1);
  sprite.renderOrder = renderOrder;
  sprite.userData.texture = texture;
  return sprite;
}

class LogPanel {
  constructor(title, { width = 1.05, height = 0.55 } = {}) {
    this.title = title;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.lines = [];
    this.render();
  }

  setTitle(title) {
    if (this.title === title) return;
    this.title = title;
    this.render();
  }

  setLines(lines) {
    const nextLines = Array.isArray(lines) ? lines : [];
    if (nextLines.length === this.lines.length && nextLines.every((line, i) => line === this.lines[i])) {
      return;
    }
    this.lines = [...nextLines];
    this.render();
  }

  render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#00ffcc';
    ctx.font = '600 34px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(this.title, 24, 24);

    ctx.fillStyle = '#f1f6ff';
    ctx.font = '28px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    let y = 80;
    const lineHeight = 36;
    for (const line of this.lines) {
      ctx.fillText(line, 24, y);
      y += lineHeight;
      if (y > this.canvas.height - lineHeight) break;
    }

    this.texture.needsUpdate = true;
  }
}

function updateOrbiterPosition(object, time) {
  const radius = object.userData.orbitRadius ?? 0.55;
  const speed = object.userData.orbitSpeed ?? 0.3;
  const angle = object.userData.baseAngle + time * speed;
  const heightPhase = object.userData.heightPhase ?? 0;
  const bobAmplitude = object.userData.bobAmplitude ?? 0.1;
  const height = Math.sin(time * 1.6 + heightPhase) * bobAmplitude;
  object.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
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

const orbiterGroup = new THREE.Group();
orbiterGroup.position.set(0, 1.5, 0);
scene.add(orbiterGroup);

function addOrbiter(object, config = {}) {
  Object.assign(object.userData, config);
  updateOrbiterPosition(object, 0);
  orbiterGroup.add(object);
}

const pyramidGeo = new THREE.TetrahedronGeometry(0.1);
const pyramidMat = new THREE.MeshStandardMaterial({
  color: 0xffc857,
  metalness: 0.2,
  roughness: 0.4,
  flatShading: true
});

const ORBITER_LABELS = ['Access', 'Sync', 'Link', 'Pulse'];
const ORBITER_TOTAL = 12;
let labelIndex = 0;

for (let i = 0; i < ORBITER_TOTAL; i++) {
  const baseAngle = (i / ORBITER_TOTAL) * Math.PI * 2;
  const heightPhase = Math.random() * Math.PI * 2;
  const orbitSpeed = 0.25 + Math.random() * 0.25;
  const bobAmplitude = 0.08 + Math.random() * 0.04;

  const config = { baseAngle, heightPhase, orbitSpeed, bobAmplitude };
  const shouldUseLabel = i % 3 === 2 && labelIndex < ORBITER_LABELS.length;

  if (shouldUseLabel) {
    const label = createLabelSprite(ORBITER_LABELS[labelIndex++], {
      width: 0.35,
      fontSize: 110,
      renderOrder: 20,
      depthTest: false
    });
    addOrbiter(label, config);
  } else {
    const pyramid = new THREE.Mesh(pyramidGeo, pyramidMat.clone());
    const spinSpeed = 0.5 + Math.random() * 0.6;
    pyramid.rotation.x = Math.PI / 3;
    addOrbiter(pyramid, { ...config, spinSpeed });
  }
}

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

const logRig = new THREE.Group();
logRig.position.set(0, 1.6, -1.2);
scene.add(logRig);

const leftLogPanel = new LogPanel('Left Hand Log');
leftLogPanel.mesh.position.set(-1.25, 0, 0);
logRig.add(leftLogPanel.mesh);

const rightLogPanel = new LogPanel('Right Hand Log');
rightLogPanel.mesh.position.set(1.25, 0, 0);
logRig.add(rightLogPanel.mesh);

const systemLogPanel = new LogPanel('System Log');
systemLogPanel.mesh.position.set(0, 0, 0);
logRig.add(systemLogPanel.mesh);

const systemMessages = [];

window.addEventListener('error', (e) => {
  systemMessages.unshift(`Error: ${e.message}`);
  systemMessages.splice(12);
});

const logRigManipulator = {
  engaged: false,
  initial: {
    midpoint: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    direction: new THREE.Vector3(1, 0, 0),
    distance: 0.4,
    quaternion: new THREE.Quaternion(),
    scale: 1
  }
};

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  const t = elapsed;
  for (const m of cubes.children) {
    m.rotation.y += 0.01;
    m.position.y = m.userData.baseY + Math.sin(t * 0.8 + m.userData.phase) * 0.08;
  }

  orbiterGroup.children.forEach((child) => {
    updateOrbiterPosition(child, elapsed);
    if (child.isMesh) {
      child.rotation.y += delta * (child.userData.spinSpeed ?? 0);
      child.rotation.x += delta * 0.4;
    }
  });

  controls.update();

  trackers.forEach((tracker) => tracker.update(elapsed, delta));

  const [leftTracker, rightTracker] = trackers;
  const leftState = leftTracker.state;
  const rightState = rightTracker.state;
  const leftWrist = leftState.wrist;
  const rightWrist = rightState.wrist;

  const bothGrabbing = Boolean(
    leftState.visible &&
      rightState.visible &&
      leftState.grab &&
      rightState.grab &&
      leftWrist &&
      rightWrist
  );

  if (bothGrabbing) {
    const midpoint = new THREE.Vector3().addVectors(leftWrist, rightWrist).multiplyScalar(0.5);
    const spanVector = new THREE.Vector3().subVectors(rightWrist, leftWrist);
    const spanLength = spanVector.length();
    const hasSpan = spanLength > 1e-4;

    if (!logRigManipulator.engaged) {
      logRigManipulator.engaged = true;
      logRigManipulator.initial.midpoint.copy(midpoint);
      logRigManipulator.initial.offset.copy(logRig.position).sub(midpoint);
      if (hasSpan) {
        logRigManipulator.initial.direction.copy(spanVector.clone().normalize());
        logRigManipulator.initial.distance = spanLength;
      } else {
        logRigManipulator.initial.direction.set(1, 0, 0);
        logRigManipulator.initial.distance = 0.3;
      }
      logRigManipulator.initial.quaternion.copy(logRig.quaternion);
      logRigManipulator.initial.scale = logRig.scale.x;
    } else {
      if (hasSpan) {
        const direction = spanVector.clone().normalize();
        const rotationDelta = new THREE.Quaternion().setFromUnitVectors(
          logRigManipulator.initial.direction,
          direction
        );
        const rotated = logRigManipulator.initial.quaternion.clone();
        rotated.premultiply(rotationDelta);
        logRig.quaternion.copy(rotated);

        const relativeScale = spanLength / Math.max(logRigManipulator.initial.distance, 0.1);
        const clampedScale = THREE.MathUtils.clamp(
          logRigManipulator.initial.scale * relativeScale,
          0.35,
          3.5
        );
        logRig.scale.setScalar(clampedScale);
      }

      const newPosition = midpoint.clone().add(logRigManipulator.initial.offset);
      logRig.position.copy(newPosition);
    }
  } else {
    logRigManipulator.engaged = false;
  }

  leftLogPanel.setLines(leftTracker.getLogLines());
  rightLogPanel.setLines(rightTracker.getLogLines());

  const generalLines = [];
  const activePinches = Object.entries(pinchTelemetry).filter(([, data]) => data && data.position);
  if (activePinches.length > 0) {
    generalLines.push('Active pinches');
    activePinches.forEach(([label, data]) => {
      generalLines.push(
        `${label}: pos (${formatVec3(data.position)})`,
        `${label}: speed ${data.speed.toFixed(3)} m/s`
      );
    });
  }

  if (bothGrabbing) {
    generalLines.push('—', 'Adjusting log cluster…', `Scale ×${logRig.scale.x.toFixed(2)}`);
  }

  if (systemMessages.length) {
    generalLines.push('—', ...systemMessages);
  }

  systemLogPanel.setLines(generalLines);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
