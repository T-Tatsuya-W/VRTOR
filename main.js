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
      palm: null,
      indexTip: null,
      thumbTip: null,
      pinch: {
        active: false,
        distance: NaN,
        position: null,
        speed: 0
      },
      grab: false,
      open: false,
      contactPoints: []
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
    const contactPoints = [];
    const palmCandidates = [];
    const wristPosition = wrist ? wrist.position.clone() : null;
    if (wristPosition) {
      contactPoints.push(wristPosition);
      palmCandidates.push(wristPosition.clone());
    }

    if (visible) {
      const tipDistances = [];
      for (const name of fingerNames) {
        const joint = joints ? joints[name] : null;
        if (!joint) continue;
        contactPoints.push(joint.position.clone());
        if (wristPosition) {
          tipDistances.push(joint.position.distanceTo(wristPosition));
        }
      }
      const palmJointNames = [
        'thumb-metacarpal',
        'index-finger-metacarpal',
        'middle-finger-metacarpal',
        'ring-finger-metacarpal',
        'pinky-finger-metacarpal'
      ];
      for (const name of palmJointNames) {
        const joint = joints ? joints[name] : null;
        if (!joint) continue;
        palmCandidates.push(joint.position.clone());
      }
      if (palmCandidates.length <= 1) {
        for (const name of fingerNames) {
          const joint = joints ? joints[name] : null;
          if (!joint) continue;
          palmCandidates.push(joint.position.clone());
        }
      }
      if (wristPosition && tipDistances.length === fingerNames.length) {
        const avg = tipDistances.reduce((sum, value) => sum + value, 0) / tipDistances.length;
        grabActive = avg < 0.09;
        openActive = avg > 0.11;
      }
    }

    let palmPosition = null;
    if (palmCandidates.length > 0) {
      palmPosition = new THREE.Vector3();
      palmCandidates.forEach((sample) => palmPosition.add(sample));
      palmPosition.multiplyScalar(1 / palmCandidates.length);
    }

    this.state = {
      visible,
      wrist: wristPosition,
      palm: palmPosition ? palmPosition.clone() : null,
      indexTip: indexTip ? indexTip.position.clone() : null,
      thumbTip: thumbTip ? thumbTip.position.clone() : null,
      pinch: {
        active: pinchActive,
        distance: pinchDistance,
        position: pinchPosition ? pinchPosition.clone() : null,
        speed: pinchSpeed
      },
      grab: grabActive,
      open: openActive,
      contactPoints
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
    this.highlighted = false;
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

  setHighlighted(highlighted) {
    if (this.highlighted === highlighted) return;
    this.highlighted = highlighted;
    this.render();
  }

  render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.highlighted ? 'rgba(0, 32, 42, 0.82)' : 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.highlighted) {
      ctx.strokeStyle = 'rgba(0, 255, 204, 0.85)';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, this.canvas.width - 12, this.canvas.height - 12);
    }

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

class ControlPanelOverlay {
  constructor({ width = 0.64, height = 0.38 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.position.set(0, 0, 0.002);
    this.mesh.renderOrder = 20;
    this.state = {
      header: 'Controls',
      singleLabel: 'Single Press',
      singleHint: 'Tap to log an event',
      toggleLabel: 'Toggle Button',
      toggleStatus: 'OFF'
    };
    this.render();
  }

  update(nextState = {}) {
    const merged = { ...this.state, ...nextState };
    const changed = Object.keys(merged).some((key) => merged[key] !== this.state[key]);
    if (!changed) return;
    this.state = merged;
    this.render();
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(8, 26, 38, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0, 255, 204, 0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    ctx.fillStyle = '#d1f8ff';
    ctx.font = '700 44px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(this.state.header, 32, 32);

    ctx.font = '600 32px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.fillStyle = '#f1f6ff';
    ctx.fillText(this.state.singleLabel, 32, 132);
    ctx.fillText(this.state.toggleLabel, canvas.width * 0.5 + 24, 132);

    ctx.font = '500 26px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(210, 235, 255, 0.8)';
    ctx.fillText(this.state.singleHint, 32, 180);
    ctx.fillText('Alternate colour each tap', canvas.width * 0.5 + 24, 220);

    ctx.font = '600 30px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    const toggleActive = this.state.toggleStatus === 'ON';
    ctx.fillStyle = toggleActive ? '#00ffcc' : '#ff9ebd';
    const statusText = `State: ${this.state.toggleStatus}`;
    ctx.fillText(statusText, canvas.width * 0.5 + 24, 180);

    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.5, 110);
    ctx.lineTo(canvas.width * 0.5, canvas.height - 32);
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.25)';
    ctx.stroke();

    this.texture.needsUpdate = true;
  }
}

class DoubleGrabController {
  constructor(group, options = {}) {
    this.group = group;
    this.options = {
      proximity: 0.25,
      minScale: 0.35,
      maxScale: 3.5,
      onReadyChange: null,
      intersectionPadding: 0.01,
      ...options
    };

    this.bounds = new THREE.Box3();
    this.intersectionBounds = new THREE.Box3();
    this.engaged = false;
    this.highlighted = false;
    this.initial = {
      midpoint: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      direction: new THREE.Vector3(1, 0, 0),
      distance: 0.3,
      quaternion: new THREE.Quaternion(),
      scale: 1
    };
    this.temp = {
      midpoint: new THREE.Vector3(),
      span: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      rotationDelta: new THREE.Quaternion(),
      workingQuaternion: new THREE.Quaternion(),
      nextPosition: new THREE.Vector3()
    };
  }

  setHighlight(value) {
    if (this.highlighted === value) return;
    this.highlighted = value;
    if (typeof this.options.onReadyChange === 'function') {
      this.options.onReadyChange(value);
    }
  }

  release() {
    if (this.engaged && DoubleGrabController.activeController === this) {
      DoubleGrabController.activeController = null;
    }
    this.engaged = false;
    this.setHighlight(false);
  }

  update(leftState, rightState) {
    const leftPoint = leftState?.palm ?? leftState?.wrist ?? null;
    const rightPoint = rightState?.palm ?? rightState?.wrist ?? null;

    this.group.updateWorldMatrix(true, true);
    this.bounds.setFromObject(this.group);
    const padding = Math.max(0, this.options.intersectionPadding ?? 0);
    this.intersectionBounds.copy(this.bounds).expandByScalar(padding);

    const blockedByOther =
      DoubleGrabController.activeController && DoubleGrabController.activeController !== this;
    const proximity = Math.max(0, this.options.proximity ?? 0);
    const hasBounds = !this.intersectionBounds.isEmpty();

    const leftDistance = hasBounds && leftPoint
      ? this.intersectionBounds.distanceToPoint(leftPoint)
      : Infinity;
    const rightDistance = hasBounds && rightPoint
      ? this.intersectionBounds.distanceToPoint(rightPoint)
      : Infinity;

    const leftTouching = Boolean(
      !blockedByOther &&
        leftState?.visible &&
        leftPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(leftPoint) || leftDistance <= proximity)
    );
    const rightTouching = Boolean(
      !blockedByOther &&
        rightState?.visible &&
        rightPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(rightPoint) || rightDistance <= proximity)
    );

    const bothTouching = leftTouching && rightTouching;
    const bothGrabbing = Boolean(leftState?.grab && rightState?.grab);
    const shouldEngage = bothTouching && bothGrabbing;

    if (!this.engaged && shouldEngage) {
      this.engaged = true;
      DoubleGrabController.activeController = this;
      const midpoint = this.temp.midpoint.copy(leftPoint).add(rightPoint).multiplyScalar(0.5);
      this.initial.midpoint.copy(midpoint);
      this.initial.offset.copy(this.group.position).sub(midpoint);
      const spanVector = this.temp.span.copy(rightPoint).sub(leftPoint);
      const spanLength = spanVector.length();
      if (spanLength > 1e-4) {
        this.initial.direction.copy(this.temp.direction.copy(spanVector).normalize());
        this.initial.distance = spanLength;
      } else {
        this.initial.direction.set(1, 0, 0);
        this.initial.distance = 0.3;
      }
      this.initial.quaternion.copy(this.group.quaternion);
      this.initial.scale = this.group.scale.x;
    }

    this.setHighlight(this.engaged || bothTouching);

    if (!this.engaged) {
      return { ready: this.highlighted, grabbing: false };
    }

    if (
      !bothGrabbing ||
      !leftPoint ||
      !rightPoint ||
      !leftState?.visible ||
      !rightState?.visible ||
      blockedByOther ||
      !bothTouching
    ) {
      this.release();
      return { ready: false, grabbing: false };
    }

    const midpoint = this.temp.midpoint.copy(leftPoint).add(rightPoint).multiplyScalar(0.5);
    const spanVector = this.temp.span.copy(rightPoint).sub(leftPoint);
    const spanLength = spanVector.length();
    if (spanLength > 1e-4) {
      const direction = this.temp.direction.copy(spanVector).normalize();
      const rotationDelta = this.temp.rotationDelta.setFromUnitVectors(
        this.initial.direction,
        direction
      );
      const rotated = this.temp.workingQuaternion.copy(this.initial.quaternion);
      rotated.premultiply(rotationDelta);
      this.group.quaternion.copy(rotated);

      const relativeScale = spanLength / Math.max(this.initial.distance, 0.1);
      const clampedScale = THREE.MathUtils.clamp(
        this.initial.scale * relativeScale,
        this.options.minScale,
        this.options.maxScale
      );
      this.group.scale.setScalar(clampedScale);
    }

    const newPosition = this.temp.nextPosition.copy(midpoint).add(this.initial.offset);
    this.group.position.copy(newPosition);

    return { ready: this.highlighted, grabbing: true };
  }
}

DoubleGrabController.activeController = null;

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

const torusLabel = createLabelSprite('VRTOR', {
  width: 0.38,
  fontSize: 160,
  color: '#f1f6ff',
  strokeStyle: 'rgba(0, 0, 0, 0.5)',
  renderOrder: 15,
  depthTest: false
});
const torusParams = torus.geometry.parameters;
const torusLabelOffset = torusParams.radius - torusParams.tube * 0.5;
torusLabel.position.set(0, 0, torusLabelOffset);
torusLabel.material.depthTest = false;
torusLabel.material.depthWrite = false;
torus.add(torusLabel);

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

const logRigController = new DoubleGrabController(logRig, {
  proximity: 0.065,
  intersectionPadding: 0.04,
  onReadyChange: (ready) => {
    [leftLogPanel, rightLogPanel, systemLogPanel].forEach((panel) => panel.setHighlighted(ready));
  }
});

const controlRig = new THREE.Group();
controlRig.position.set(-0.9, 1.25, -1.05);
controlRig.rotation.y = Math.PI / 8;
scene.add(controlRig);

const controlPanelMaterial = new THREE.MeshStandardMaterial({
  color: 0x0c1f2b,
  emissive: 0x062b3f,
  emissiveIntensity: 0.35,
  metalness: 0.2,
  roughness: 0.65,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide
});
const controlPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.42), controlPanelMaterial);
controlPanel.position.set(0, 0, 0);
controlRig.add(controlPanel);

const controlPanelFrame = new THREE.Mesh(
  new THREE.PlaneGeometry(0.72, 0.46),
  new THREE.MeshBasicMaterial({ color: 0x031018, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
);
controlPanelFrame.position.set(0, 0, -0.01);
controlRig.add(controlPanelFrame);

const controlPanelOverlay = new ControlPanelOverlay();
controlRig.add(controlPanelOverlay.mesh);

const controlButtonMaterial = new THREE.MeshStandardMaterial({
  color: 0x3ab0ff,
  emissive: 0x001c38,
  emissiveIntensity: 0.45,
  metalness: 0.45,
  roughness: 0.4
});
const controlButton = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.1), controlButtonMaterial);
controlButton.position.set(-0.18, -0.03, 0.06);
controlRig.add(controlButton);
controlButton.geometry.computeBoundingBox();
const controlButtonHalfExtents = new THREE.Vector3();
controlButton.geometry.boundingBox
  .getSize(controlButtonHalfExtents)
  .multiplyScalar(0.5);

const controlButtonState = {
  baseColor: new THREE.Color(0x3ab0ff),
  activeColor: new THREE.Color(0xff7f9e),
  restZ: controlButton.position.z,
  maxPressDepth: 0.045,
  currentDepth: 0,
  targetDepth: 0,
  damping: 18,
  activationThreshold: 0.95,
  releaseThreshold: 0.2,
  latched: false,
  ready: false,
  contactPadding: 0.012,
  depthBias: 0.003,
  halfExtents: controlButtonHalfExtents
};

const toggleButtonMaterial = new THREE.MeshStandardMaterial({
  color: 0xff5fa2,
  emissive: 0x3a001f,
  emissiveIntensity: 0.4,
  metalness: 0.45,
  roughness: 0.38
});
const toggleButton = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.1), toggleButtonMaterial);
toggleButton.position.set(0.18, -0.03, 0.06);
controlRig.add(toggleButton);
toggleButton.geometry.computeBoundingBox();
const toggleButtonHalfExtents = new THREE.Vector3();
toggleButton.geometry.boundingBox
  .getSize(toggleButtonHalfExtents)
  .multiplyScalar(0.5);

const toggleButtonState = {
  offColor: new THREE.Color(0xff5fa2),
  offActiveColor: new THREE.Color(0xff8cc4),
  onColor: new THREE.Color(0x4dffc3),
  onActiveColor: new THREE.Color(0x8dffe0),
  restZ: toggleButton.position.z,
  maxPressDepth: 0.045,
  currentDepth: 0,
  targetDepth: 0,
  damping: 18,
  activationThreshold: 0.95,
  releaseThreshold: 0.35,
  latched: false,
  ready: false,
  toggled: false,
  contactPadding: 0.012,
  depthBias: 0.003,
  halfExtents: toggleButtonHalfExtents
};

const controlRigController = new DoubleGrabController(controlRig, {
  proximity: 0.055,
  intersectionPadding: 0.03,
  minScale: 0.45,
  maxScale: 2.5,
  onReadyChange: (ready) => {
    controlPanelMaterial.emissiveIntensity = ready ? 0.9 : 0.35;
    controlButtonState.ready = ready;
    toggleButtonState.ready = ready;
  }
});

const buttonWorkVector = new THREE.Vector3();

function computeButtonTargetDepth(button, state, handStates) {
  const halfExtents = state.halfExtents;
  if (!halfExtents) return 0;
  const padding = state.contactPadding ?? 0.012;
  const depthBias = state.depthBias ?? 0;
  let maxDepth = 0;

  for (const handState of handStates) {
    if (!handState?.visible) continue;
    const contactPoints = Array.isArray(handState.contactPoints) ? handState.contactPoints : [];
    for (const point of contactPoints) {
      buttonWorkVector.copy(point);
      button.worldToLocal(buttonWorkVector);
      if (
        Math.abs(buttonWorkVector.x) <= halfExtents.x + padding &&
        Math.abs(buttonWorkVector.y) <= halfExtents.y + padding
      ) {
        const depth = halfExtents.z - buttonWorkVector.z + depthBias;
        if (depth > maxDepth) {
          maxDepth = depth;
        }
      }
    }
    const pinchPoint = handState.pinch?.position ?? null;
    if (pinchPoint) {
      buttonWorkVector.copy(pinchPoint);
      button.worldToLocal(buttonWorkVector);
      if (
        Math.abs(buttonWorkVector.x) <= halfExtents.x + padding &&
        Math.abs(buttonWorkVector.y) <= halfExtents.y + padding
      ) {
        const depth = halfExtents.z - buttonWorkVector.z + depthBias;
        if (depth > maxDepth) {
          maxDepth = depth;
        }
      }
    }
  }

  return THREE.MathUtils.clamp(maxDepth, 0, state.maxPressDepth);
}

function updatePanelButton(button, state, leftState, rightState, delta) {
  button.updateWorldMatrix(true, false);
  const targetDepth = computeButtonTargetDepth(button, state, [leftState, rightState]);
  state.targetDepth = targetDepth;
  const damping = state.damping ?? 18;
  state.currentDepth = THREE.MathUtils.damp(state.currentDepth, targetDepth, damping, delta);
  if (Math.abs(state.currentDepth - targetDepth) < 1e-4) {
    state.currentDepth = targetDepth;
  }
  state.currentDepth = THREE.MathUtils.clamp(state.currentDepth, 0, state.maxPressDepth);
  button.position.z = state.restZ - state.currentDepth;
  return state.maxPressDepth > 0
    ? THREE.MathUtils.clamp(state.currentDepth / state.maxPressDepth, 0, 1)
    : 0;
}

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  controls.update();

  trackers.forEach((tracker) => tracker.update(elapsed, delta));

  const [leftTracker, rightTracker] = trackers;
  const leftState = leftTracker.state;
  const rightState = rightTracker.state;
  const logRigStatus = logRigController.update(leftState, rightState);
  const controlRigStatus = controlRigController.update(leftState, rightState);

  const controlPressRatio = updatePanelButton(
    controlButton,
    controlButtonState,
    leftState,
    rightState,
    delta
  );
  const togglePressRatio = updatePanelButton(
    toggleButton,
    toggleButtonState,
    leftState,
    rightState,
    delta
  );

  if (controlPressRatio >= controlButtonState.activationThreshold) {
    if (!controlButtonState.latched) {
      controlButtonState.latched = true;
      systemMessages.unshift('Single press activated');
      systemMessages.splice(12);
    }
  } else if (controlButtonState.latched && controlPressRatio <= controlButtonState.releaseThreshold) {
    controlButtonState.latched = false;
  }

  if (togglePressRatio >= toggleButtonState.activationThreshold) {
    if (!toggleButtonState.latched) {
      toggleButtonState.latched = true;
      toggleButtonState.toggled = !toggleButtonState.toggled;
      const toggleLabel = toggleButtonState.toggled ? 'ON' : 'OFF';
      systemMessages.unshift(`Toggle button: ${toggleLabel}`);
      systemMessages.splice(12);
      controlPanelOverlay.update({ toggleStatus: toggleLabel });
    }
  } else if (toggleButtonState.latched && togglePressRatio <= toggleButtonState.releaseThreshold) {
    toggleButtonState.latched = false;
  }

  controlButtonMaterial.color
    .copy(controlButtonState.baseColor)
    .lerp(controlButtonState.activeColor, controlPressRatio);
  const controlEmissiveBase = controlButtonState.ready ? 0.95 : 0.45;
  controlButtonMaterial.emissiveIntensity = controlEmissiveBase + controlPressRatio * 1.05;

  const toggleBaseColor = toggleButtonState.toggled
    ? toggleButtonState.onColor
    : toggleButtonState.offColor;
  const toggleActiveColor = toggleButtonState.toggled
    ? toggleButtonState.onActiveColor
    : toggleButtonState.offActiveColor;
  toggleButtonMaterial.color.copy(toggleBaseColor).lerp(toggleActiveColor, togglePressRatio);
  const toggleEmissiveBase = toggleButtonState.ready
    ? toggleButtonState.toggled
      ? 1
      : 0.6
    : 0.4;
  toggleButtonMaterial.emissiveIntensity = toggleEmissiveBase + togglePressRatio * 0.9;

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

  generalLines.push(
    `Single press ready: ${controlButtonState.ready ? 'YES' : 'no'}`,
    `Toggle button: ${toggleButtonState.toggled ? 'ON' : 'OFF'}`
  );

  const statusLines = [];
  if (logRigStatus.grabbing) {
    statusLines.push('Adjusting log cluster…', `Scale ×${logRig.scale.x.toFixed(2)}`);
  }
  if (controlRigStatus.grabbing) {
    statusLines.push('Moving control panel…');
  }
  if (statusLines.length > 0) {
    generalLines.push('—', ...statusLines);
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
