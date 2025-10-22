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

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  if (!text) {
    return y;
  }

  const words = `${text}`.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return y;
  }

  let line = '';
  let cursorY = y;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }

  if (line) {
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }

  return cursorY;
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
  constructor({ width = 1.08, height = 0.44 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
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
      toggleStatus: 'OFF',
      toggleHint: 'Alternate colour each tap',
      sliderLabel: 'Throttle Lever',
      sliderValue: '40%',
      sliderHint: 'Grab the handle and move to choose a value',
      rotaryLabel: 'Gear Selector',
      rotaryValue: 'Apple',
      rotaryHint: 'Rotate the cog to browse the list',
      highlighted: false
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

    const highlighted = Boolean(this.state.highlighted);
    ctx.fillStyle = highlighted ? 'rgba(0, 32, 42, 0.82)' : 'rgba(8, 26, 38, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = highlighted ? 'rgba(0, 255, 204, 0.85)' : 'rgba(0, 255, 204, 0.3)';
    ctx.lineWidth = highlighted ? 10 : 4;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    ctx.fillStyle = '#d1f8ff';
    ctx.font = '700 48px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(this.state.header, 32, 36);

    const columnCount = 4;
    const columnWidth = (canvas.width - 64) / columnCount;
    const contentY = 132;

    ctx.strokeStyle = 'rgba(0, 255, 204, 0.18)';
    ctx.lineWidth = 3;
    for (let i = 1; i < columnCount; i += 1) {
      const x = 32 + columnWidth * i;
      ctx.beginPath();
      ctx.moveTo(x, 112);
      ctx.lineTo(x, canvas.height - 36);
      ctx.stroke();
    }

    const columns = [
      {
        title: this.state.singleLabel,
        valueLabel: 'Action',
        value: 'Tap to log an event',
        accent: '#00d4ff',
        hint: this.state.singleHint
      },
      {
        title: this.state.toggleLabel,
        valueLabel: 'State',
        value: this.state.toggleStatus,
        accent: this.state.toggleStatus === 'ON' ? '#00ffcc' : '#ff9ebd',
        hint: this.state.toggleHint
      },
      {
        title: this.state.sliderLabel,
        valueLabel: 'Value',
        value: this.state.sliderValue,
        accent: '#00ffcc',
        hint: this.state.sliderHint
      },
      {
        title: this.state.rotaryLabel,
        valueLabel: 'Selected',
        value: this.state.rotaryValue,
        accent: '#ffd27a',
        hint: this.state.rotaryHint
      }
    ];

    columns.forEach((column, index) => {
      const x = 32 + columnWidth * index;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f1f6ff';
      ctx.font = '600 34px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillText(column.title, x, contentY);

      ctx.font = '600 30px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillStyle = column.accent;
      const line = `${column.valueLabel}: ${column.value}`;
      ctx.fillText(line, x, contentY + 46);

      ctx.font = '500 24px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(210, 235, 255, 0.82)';
      drawWrappedText(ctx, column.hint, x, contentY + 86, columnWidth - 32, 30);
    });

    this.texture.needsUpdate = true;
  }
}

const buttonWorkVector = new THREE.Vector3();

class PanelButton {
  constructor({
    size = { width: 0.24, height: 0.1, depth: 0.1 },
    position = new THREE.Vector3(),
    baseColor = 0x3ab0ff,
    activeColor = 0xff7f9e,
    emissiveColor = 0x001c38,
    emissiveConfig = { idle: 0.45, ready: 0.95, activeScale: 1.05 },
    maxPressDepth = 0.045,
    damping = 18,
    activationThreshold = 0.95,
    releaseThreshold = 0.2,
    contactPadding = 0.012,
    depthBias = 0.003,
    metalness = 0.45,
    roughness = 0.4
  } = {}) {
    this.colors = {
      base: new THREE.Color(baseColor),
      active: new THREE.Color(activeColor)
    };
    this.emissiveColor = new THREE.Color(emissiveColor);
    this.emissiveConfig = {
      idle: emissiveConfig?.idle ?? 0.45,
      ready: emissiveConfig?.ready ?? 0.95,
      activeScale: emissiveConfig?.activeScale ?? 1.05
    };

    const geometry = new THREE.BoxGeometry(size.width, size.height, size.depth);
    this.material = new THREE.MeshStandardMaterial({
      color: this.colors.base.clone(),
      emissive: this.emissiveColor.clone(),
      emissiveIntensity: this.emissiveConfig.idle,
      metalness,
      roughness
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    if (position instanceof THREE.Vector3) {
      this.mesh.position.copy(position);
    } else if (Array.isArray(position)) {
      this.mesh.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }

    this.mesh.geometry.computeBoundingBox();
    const halfExtents = new THREE.Vector3();
    this.mesh.geometry.boundingBox.getSize(halfExtents).multiplyScalar(0.5);

    this.state = {
      restZ: this.mesh.position.z,
      maxPressDepth,
      currentDepth: 0,
      targetDepth: 0,
      damping,
      activationThreshold,
      releaseThreshold,
      latched: false,
      ready: false,
      contactPadding,
      depthBias,
      halfExtents
    };
  }

  setColors(base, active) {
    if (base !== undefined) {
      this.colors.base.copy(base instanceof THREE.Color ? base : new THREE.Color(base));
    }
    if (active !== undefined) {
      this.colors.active.copy(active instanceof THREE.Color ? active : new THREE.Color(active));
    }
    this.material.color.copy(this.colors.base);
  }

  setEmissiveConfig({ idle, ready, activeScale } = {}) {
    this.emissiveConfig = {
      idle: idle ?? this.emissiveConfig.idle,
      ready: ready ?? this.emissiveConfig.ready,
      activeScale: activeScale ?? this.emissiveConfig.activeScale
    };
    const ratio = this.state.maxPressDepth > 0
      ? THREE.MathUtils.clamp(this.state.currentDepth / this.state.maxPressDepth, 0, 1)
      : 0;
    this.updateEmissiveIntensity(ratio);
  }

  updateEmissiveIntensity(ratio) {
    const base = this.state.ready ? this.emissiveConfig.ready : this.emissiveConfig.idle;
    this.material.emissiveIntensity = base + ratio * this.emissiveConfig.activeScale;
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    const ratio = this.state.maxPressDepth > 0
      ? THREE.MathUtils.clamp(this.state.currentDepth / this.state.maxPressDepth, 0, 1)
      : 0;
    this.updateEmissiveIntensity(ratio);
  }

  update(leftState, rightState, delta) {
    this.mesh.updateWorldMatrix(true, false);
    const targetDepth = computeButtonTargetDepth(this.mesh, this.state, [leftState, rightState]);
    this.state.targetDepth = targetDepth;
    const damping = this.state.damping ?? 18;
    this.state.currentDepth = THREE.MathUtils.damp(this.state.currentDepth, targetDepth, damping, delta);
    if (Math.abs(this.state.currentDepth - targetDepth) < 1e-4) {
      this.state.currentDepth = targetDepth;
    }
    this.state.currentDepth = THREE.MathUtils.clamp(this.state.currentDepth, 0, this.state.maxPressDepth);
    this.mesh.position.z = this.state.restZ - this.state.currentDepth;
    const ratio = this.state.maxPressDepth > 0
      ? THREE.MathUtils.clamp(this.state.currentDepth / this.state.maxPressDepth, 0, 1)
      : 0;
    this.material.color.copy(this.colors.base).lerp(this.colors.active, ratio);
    this.updateEmissiveIntensity(ratio);

    const pressed = ratio >= this.state.activationThreshold;
    let justActivated = false;
    let justReleased = false;
    if (pressed && !this.state.latched) {
      this.state.latched = true;
      justActivated = true;
    } else if (!pressed && this.state.latched && ratio <= this.state.releaseThreshold) {
      this.state.latched = false;
      justReleased = true;
    }

    return { ratio, pressed, justActivated, justReleased };
  }
}

class PanelToggleButton {
  constructor({
    position = new THREE.Vector3(),
    offColor = 0xff5fa2,
    offActiveColor = 0xff8cc4,
    onColor = 0x4dffc3,
    onActiveColor = 0x8dffe0,
    emissiveColor = 0x3a001f,
    emissiveConfig = {
      off: { idle: 0.4, ready: 0.6, activeScale: 0.9 },
      on: { idle: 0.6, ready: 1, activeScale: 0.9 }
    },
    activationThreshold = 0.95,
    releaseThreshold = 0.35,
    onToggle = null
  } = {}) {
    const mergedEmissive = {
      off: {
        idle: 0.4,
        ready: 0.6,
        activeScale: 0.9,
        ...(emissiveConfig?.off ?? {})
      },
      on: {
        idle: 0.6,
        ready: 1,
        activeScale: 0.9,
        ...(emissiveConfig?.on ?? {})
      }
    };

    this.button = new PanelButton({
      position,
      baseColor: offColor,
      activeColor: offActiveColor,
      emissiveColor,
      emissiveConfig: mergedEmissive.off,
      maxPressDepth: 0.045,
      damping: 18,
      activationThreshold,
      releaseThreshold,
      contactPadding: 0.012,
      depthBias: 0.003,
      metalness: 0.45,
      roughness: 0.38
    });

    this.colors = {
      off: new THREE.Color(offColor),
      offActive: new THREE.Color(offActiveColor),
      on: new THREE.Color(onColor),
      onActive: new THREE.Color(onActiveColor)
    };
    this.emissive = mergedEmissive;
    this.toggled = false;
    this.onToggle = onToggle;
    this.updateAppearance();
  }

  get mesh() {
    return this.button.mesh;
  }

  setReady(ready) {
    this.button.setReady(ready);
    this.updateAppearance();
  }

  setToggled(value) {
    const next = Boolean(value);
    if (this.toggled === next) return;
    this.toggled = next;
    this.updateAppearance();
  }

  updateAppearance() {
    const base = this.toggled ? this.colors.on : this.colors.off;
    const active = this.toggled ? this.colors.onActive : this.colors.offActive;
    const emissiveConfig = this.toggled ? this.emissive.on : this.emissive.off;
    this.button.setColors(base, active);
    this.button.setEmissiveConfig(emissiveConfig);
  }

  update(leftState, rightState, delta) {
    this.updateAppearance();
    const result = this.button.update(leftState, rightState, delta);
    if (result.justActivated) {
      this.toggled = !this.toggled;
      this.updateAppearance();
      if (typeof this.onToggle === 'function') {
        this.onToggle(this.toggled);
      }
    }
    return { ...result, toggled: this.toggled };
  }
}

class ThrottleLeverControl {
  constructor({
    position = new THREE.Vector3(),
    initialValue = 0.4,
    minPosition = -0.15,
    maxPosition = 0.15,
    grabPadding = 0.03,
    damping = 16,
    onValueChange = null
  } = {}) {
    this.group = new THREE.Group();
    if (position instanceof THREE.Vector3) {
      this.group.position.copy(position);
    } else if (Array.isArray(position)) {
      this.group.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }

    this.trackMaterial = new THREE.MeshStandardMaterial({
      color: 0x10465a,
      emissive: 0x022130,
      emissiveIntensity: 0.45,
      metalness: 0.5,
      roughness: 0.38,
      transparent: true,
      opacity: 0.92
    });
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.045), this.trackMaterial);
    this.group.add(track);

    const backplate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.04, 0.18),
      new THREE.MeshStandardMaterial({
        color: 0x082735,
        emissive: 0x04121b,
        emissiveIntensity: 0.25,
        metalness: 0.35,
        roughness: 0.6,
        transparent: true,
        opacity: 0.9
      })
    );
    backplate.position.set(0, -0.18, -0.02);
    backplate.rotation.x = -Math.PI / 2;
    this.group.add(backplate);

    this.handleMaterial = new THREE.MeshStandardMaterial({
      color: 0x4dffc3,
      emissive: 0x0b382d,
      emissiveIntensity: 0.95,
      metalness: 0.52,
      roughness: 0.28
    });
    this.handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.12), this.handleMaterial);
    this.handle.position.set(0, 0, 0.065);
    this.group.add(this.handle);

    this.state = {
      minPosition,
      maxPosition,
      currentValue: initialValue,
      targetValue: initialValue,
      damping,
      ready: false,
      grabbedBy: null,
      grabOffset: 0,
      grabPadding,
      bounding: new THREE.Box3(),
      paddedBounding: new THREE.Box3()
    };
    this.onValueChange = onValueChange;
    this.lastReportedValue = initialValue;
    this.workVector = new THREE.Vector3();

    const initialY = THREE.MathUtils.lerp(minPosition, maxPosition, initialValue);
    this.handle.position.y = initialY;
    this.handle.rotation.x = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-18, 10, initialValue));
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    if (!ready) {
      this.state.grabbedBy = null;
      this.state.grabOffset = 0;
    }
    this.trackMaterial.emissiveIntensity = ready ? 0.75 : 0.4;
    this.handleMaterial.emissiveIntensity = ready ? 1.15 : 0.65;
  }

  getValueFromLocalY(localY) {
    const range = this.state.maxPosition - this.state.minPosition;
    if (range <= 0) return 0;
    const normalized = (localY - this.state.minPosition) / range;
    return THREE.MathUtils.clamp(normalized, 0, 1);
  }

  update(leftState, rightState, delta) {
    const participants = [
      { label: 'L', data: leftState },
      { label: 'R', data: rightState }
    ];

    this.group.updateWorldMatrix(true, false);
    this.handle.updateWorldMatrix(true, false);
    this.state.bounding.setFromObject(this.handle);
    this.state.paddedBounding
      .copy(this.state.bounding)
      .expandByScalar(this.state.grabPadding ?? 0.03);

    if (!this.state.ready) {
      this.state.grabbedBy = null;
      this.state.grabOffset = 0;
    }

    if (this.state.grabbedBy) {
      const active = participants.find((entry) => entry.label === this.state.grabbedBy);
      const pinch = active?.data?.pinch ?? null;
      const pinchActive = Boolean(active?.data?.visible && pinch?.active && pinch?.position);
      if (!pinchActive) {
        this.state.grabbedBy = null;
        this.state.grabOffset = 0;
      }
    }

    if (!this.state.grabbedBy && this.state.ready) {
      for (const entry of participants) {
        const pinch = entry.data?.pinch ?? null;
        if (!entry.data?.visible || !pinch?.active || !pinch.position) continue;
        if (!this.state.paddedBounding.containsPoint(pinch.position)) continue;
        this.workVector.copy(pinch.position);
        this.group.worldToLocal(this.workVector);
        const pinchValue = this.getValueFromLocalY(this.workVector.y);
        this.state.grabbedBy = entry.label;
        this.state.grabOffset = pinchValue - this.state.currentValue;
        break;
      }
    }

    if (this.state.grabbedBy) {
      const active = participants.find((entry) => entry.label === this.state.grabbedBy);
      const pinch = active?.data?.pinch ?? null;
      if (pinch?.position) {
        this.workVector.copy(pinch.position);
        this.group.worldToLocal(this.workVector);
        const pinchValue = this.getValueFromLocalY(this.workVector.y);
        this.state.targetValue = THREE.MathUtils.clamp(pinchValue - this.state.grabOffset, 0, 1);
      }
    } else {
      this.state.targetValue = THREE.MathUtils.clamp(this.state.targetValue, 0, 1);
    }

    const damping = this.state.damping ?? 16;
    this.state.currentValue = THREE.MathUtils.damp(
      this.state.currentValue,
      this.state.targetValue,
      damping,
      delta
    );
    if (Math.abs(this.state.currentValue - this.state.targetValue) < 1e-4) {
      this.state.currentValue = this.state.targetValue;
    }

    const handleY = THREE.MathUtils.lerp(
      this.state.minPosition,
      this.state.maxPosition,
      this.state.currentValue
    );
    this.handle.position.y = handleY;
    this.handle.rotation.x = THREE.MathUtils.degToRad(
      THREE.MathUtils.lerp(-18, 10, this.state.currentValue)
    );
    this.handle.updateMatrix();
    this.handle.updateMatrixWorld(true);
    this.state.bounding.setFromObject(this.handle);
    this.state.paddedBounding
      .copy(this.state.bounding)
      .expandByScalar(this.state.grabPadding ?? 0.03);

    const trackIntensity = this.state.ready ? 0.45 + this.state.currentValue * 0.4 : 0.35;
    const handleIntensity = this.state.ready
      ? 1 + this.state.currentValue * 0.5 + (this.state.grabbedBy ? 0.4 : 0)
      : 0.6;
    this.trackMaterial.emissiveIntensity = trackIntensity;
    this.handleMaterial.emissiveIntensity = handleIntensity;

    if (typeof this.onValueChange === 'function') {
      if (Math.abs(this.state.currentValue - this.lastReportedValue) > 1e-4) {
        this.lastReportedValue = this.state.currentValue;
        this.onValueChange(this.state.currentValue, this.state.grabbedBy);
      }
    }

    return {
      value: this.state.currentValue,
      grabbing: Boolean(this.state.grabbedBy),
      activeHand: this.state.grabbedBy
    };
  }
}

class RotarySelectorControl {
  constructor({
    position = new THREE.Vector3(),
    labels = ['Apple', 'Banana', 'Cherry', 'Dragonfruit', 'Elderberry', 'Fig'],
    onSelectionChange = null
  } = {}) {
    const defaults = ['Apple', 'Banana', 'Cherry', 'Dragonfruit', 'Elderberry', 'Fig'];
    this.labels = Array.isArray(labels) && labels.length ? [...labels] : [...defaults];
    this.onSelectionChange = onSelectionChange;
    this.faceCount = 6;
    if (this.labels.length < this.faceCount) {
      const fallbacks = ['Guava', 'Honeydew', 'Kiwi', 'Lemon', 'Mango', 'Nectarine'];
      let filler = 0;
      while (this.labels.length < this.faceCount) {
        this.labels.push(fallbacks[filler % fallbacks.length]);
        filler += 1;
      }
    } else if (this.labels.length > this.faceCount) {
      this.labels.length = this.faceCount;
    }

    this.segmentAngle = (Math.PI * 2) / this.faceCount;
    this.geometryOffset = Math.PI / 3;

    this.group = new THREE.Group();
    if (position instanceof THREE.Vector3) {
      this.group.position.copy(position);
    } else if (Array.isArray(position)) {
      this.group.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }

    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    this.barrelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c4d62,
      emissive: 0x05202c,
      emissiveIntensity: 0.4,
      metalness: 0.55,
      roughness: 0.42,
      flatShading: true
    });

    const barrelGeometry = new THREE.CylinderGeometry(0.14, 0.14, 0.18, this.faceCount, 1, false);
    barrelGeometry.rotateY(this.geometryOffset);
    this.barrel = new THREE.Mesh(barrelGeometry, this.barrelMaterial);
    this.barrel.castShadow = true;
    this.barrel.receiveShadow = true;
    this.pivot.add(this.barrel);

    const edgeGeometry = new THREE.EdgesGeometry(barrelGeometry, 20);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x081821, linewidth: 1 });
    const barrelEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    this.barrel.add(barrelEdges);

    this.axleMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a1a21,
      emissive: 0x02070b,
      emissiveIntensity: 0.55,
      metalness: 0.62,
      roughness: 0.45
    });
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 32), this.axleMaterial);
    this.pivot.add(axle);

    this.faceRoot = new THREE.Group();
    this.pivot.add(this.faceRoot);

    this.faceMeshes = [];
    this.faceTextureCache = new Map();
    const faceWidth = 0.18;
    const faceHeight = 0.16;
    const faceRadius = 0.141;

    for (let index = 0; index < this.faceCount; index += 1) {
      const faceAngle = index * this.segmentAngle + this.geometryOffset;
      const faceGroup = new THREE.Group();
      faceGroup.rotation.y = faceAngle;
      this.faceRoot.add(faceGroup);

      const material = new THREE.MeshStandardMaterial({
        color: 0x133746,
        emissive: 0x04151d,
        emissiveIntensity: 0.25,
        metalness: 0.34,
        roughness: 0.58,
        transparent: true,
        side: THREE.DoubleSide
      });

      const panel = new THREE.Mesh(new THREE.PlaneGeometry(faceWidth, faceHeight), material);
      panel.position.set(0, 0, faceRadius + 0.002);
      panel.renderOrder = 12;
      faceGroup.add(panel);

      this.faceMeshes.push({ group: faceGroup, mesh: panel, material });
    }

    this.state = {
      ready: false,
      grabbedBy: null,
      lastGrabAngle: null,
      rawAngle: 0,
      currentAngle: 0,
      targetAngle: 0,
      damping: 12,
      innerRadius: 0.05,
      outerRadius: 0.17,
      heightAllowance: 0.12,
      selectedIndex: 0
    };
    this.workVector = new THREE.Vector3();

    this.refreshFaceTextures(false);
    this.updateHighlight(false);
  }

  getFaceTexture(label, selected) {
    const key = `${label}|${selected ? 'active' : 'idle'}`;
    if (this.faceTextureCache.has(key)) {
      return this.faceTextureCache.get(key);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    if (selected) {
      gradient.addColorStop(0, '#1f6d89');
      gradient.addColorStop(1, '#0f3c51');
    } else {
      gradient.addColorStop(0, '#113043');
      gradient.addColorStop(1, '#0b212f');
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = selected ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = selected ? 18 : 10;
    context.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);

    context.font = `${selected ? '600' : '500'} 180px "Trebuchet MS", "Segoe UI", sans-serif`;
    context.fillStyle = selected ? '#f7fffb' : '#d7e9fb';
    context.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    context.lineWidth = selected ? 16 : 12;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.strokeText(label, canvas.width / 2, canvas.height / 2);
    context.fillText(label, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    this.faceTextureCache.set(key, texture);
    return texture;
  }

  refreshFaceTextures(grabbing) {
    const ready = this.state.ready;
    this.faceMeshes.forEach((entry, index) => {
      const selected = index === this.state.selectedIndex;
      const texture = this.getFaceTexture(this.labels[index], selected);
      if (entry.material.map !== texture) {
        entry.material.map = texture;
        entry.material.needsUpdate = true;
      }
      entry.material.color.set(selected ? 0x1c5f79 : 0x133746);
      entry.material.emissiveIntensity = selected
        ? grabbing
          ? 1.35
          : ready
            ? 1.0
            : 0.72
        : ready
          ? 0.42
          : 0.22;
      entry.material.opacity = selected ? 1 : 0.88;
    });
  }

  updateHighlight(grabbing) {
    if (grabbing) {
      this.barrelMaterial.emissiveIntensity = 1.05;
      this.axleMaterial.emissiveIntensity = 0.85;
    } else if (this.state.ready) {
      this.barrelMaterial.emissiveIntensity = 0.75;
      this.axleMaterial.emissiveIntensity = 0.68;
    } else {
      this.barrelMaterial.emissiveIntensity = 0.4;
      this.axleMaterial.emissiveIntensity = 0.55;
    }
    this.refreshFaceTextures(grabbing);
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    if (!ready) {
      this.state.grabbedBy = null;
      this.state.lastGrabAngle = null;
    }
    this.updateHighlight(false);
  }

  update(leftState, rightState, delta) {
    const participants = [
      { label: 'L', data: leftState },
      { label: 'R', data: rightState }
    ];

    if (!this.state.ready) {
      this.state.grabbedBy = null;
      this.state.lastGrabAngle = null;
    }

    if (this.state.grabbedBy) {
      const active = participants.find((entry) => entry.label === this.state.grabbedBy);
      const pinch = active?.data?.pinch ?? null;
      const pinchActive = Boolean(active?.data?.visible && pinch?.active && pinch?.position);
      if (!pinchActive) {
        this.state.grabbedBy = null;
        this.state.lastGrabAngle = null;
      }
    }

    if (!this.state.grabbedBy && this.state.ready) {
      for (const entry of participants) {
        const pinch = entry.data?.pinch ?? null;
        if (!entry.data?.visible || !pinch?.active || !pinch.position) continue;
        this.workVector.copy(pinch.position);
        this.group.worldToLocal(this.workVector);
        const radius = Math.hypot(this.workVector.x, this.workVector.z);
        if (radius < this.state.innerRadius || radius > this.state.outerRadius) continue;
        if (Math.abs(this.workVector.y) > this.state.heightAllowance) continue;
        const angle = Math.atan2(this.workVector.x, this.workVector.z);
        this.state.grabbedBy = entry.label;
        this.state.lastGrabAngle = angle;
        break;
      }
    }

    if (this.state.grabbedBy) {
      const active = participants.find((entry) => entry.label === this.state.grabbedBy);
      const pinch = active?.data?.pinch ?? null;
      if (pinch?.position) {
        this.workVector.copy(pinch.position);
        this.group.worldToLocal(this.workVector);
        const angle = Math.atan2(this.workVector.x, this.workVector.z);
        if (this.state.lastGrabAngle === null) {
          this.state.lastGrabAngle = angle;
        }
        let deltaAngle = angle - this.state.lastGrabAngle;
        deltaAngle = Math.atan2(Math.sin(deltaAngle), Math.cos(deltaAngle));
        this.state.rawAngle += deltaAngle;
        this.state.lastGrabAngle = angle;
        this.state.targetAngle = this.state.rawAngle;
      }
    } else {
      this.state.lastGrabAngle = null;
    }

    const segment = this.segmentAngle;
    const rawIndex = Math.round(this.state.rawAngle / segment);
    const normalizedIndex = ((rawIndex % this.labels.length) + this.labels.length) % this.labels.length;
    if (normalizedIndex !== this.state.selectedIndex) {
      this.state.selectedIndex = normalizedIndex;
      if (typeof this.onSelectionChange === 'function') {
        this.onSelectionChange(this.labels[this.state.selectedIndex], this.state.selectedIndex);
      }
    }

    if (!this.state.grabbedBy) {
      const snappedAngle = rawIndex * segment;
      this.state.rawAngle = snappedAngle;
      this.state.targetAngle = snappedAngle;
    }

    const target = this.state.targetAngle ?? 0;
    this.state.currentAngle = THREE.MathUtils.damp(
      this.state.currentAngle,
      target,
      this.state.damping,
      delta
    );
    if (Math.abs(this.state.currentAngle - target) < 1e-4) {
      this.state.currentAngle = target;
    }

    this.pivot.rotation.y = -this.state.currentAngle;

    const grabbing = Boolean(this.state.grabbedBy);
    this.updateHighlight(grabbing);

    return {
      grabbing,
      activeHand: this.state.grabbedBy,
      selectedIndex: this.state.selectedIndex,
      selectedLabel: this.labels[this.state.selectedIndex]
    };
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

    this.localBounds = new THREE.Box3();
    this.intersectionBounds = new THREE.Box3();
    this.boundsBox = new THREE.Box3();
    this.boundsMatrix = new THREE.Matrix4();
    this.inverseMatrix = new THREE.Matrix4();
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
      nextPosition: new THREE.Vector3(),
      leftLocal: new THREE.Vector3(),
      rightLocal: new THREE.Vector3()
    };

    this.group.updateWorldMatrix(true, true);
    this.computeLocalBounds();
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

  computeLocalBounds() {
    this.inverseMatrix.copy(this.group.matrixWorld).invert();
    this.localBounds.makeEmpty();

    this.group.traverse((object) => {
      const geometry = object.geometry;
      if (!geometry || (!object.isMesh && !object.isLine && !object.isPoints)) {
        return;
      }
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }
      if (!geometry.boundingBox) {
        return;
      }

      this.boundsBox.copy(geometry.boundingBox);
      this.boundsMatrix.copy(object.matrixWorld).premultiply(this.inverseMatrix);
      this.boundsBox.applyMatrix4(this.boundsMatrix);
      this.localBounds.union(this.boundsBox);
    });

    if (this.localBounds.isEmpty()) {
      this.localBounds.setFromCenterAndSize(
        new THREE.Vector3(),
        new THREE.Vector3(0.01, 0.01, 0.01)
      );
    }
  }

  update(leftState, rightState) {
    const leftPoint = leftState?.palm ?? leftState?.wrist ?? null;
    const rightPoint = rightState?.palm ?? rightState?.wrist ?? null;

    this.group.updateWorldMatrix(true, true);
    this.computeLocalBounds();
    const averageScale =
      (Math.abs(this.group.scale.x) + Math.abs(this.group.scale.y) + Math.abs(this.group.scale.z)) / 3 || 1;
    const paddingWorld = Math.max(0, this.options.intersectionPadding ?? 0);
    const paddingLocal = paddingWorld / averageScale;
    this.intersectionBounds.copy(this.localBounds);
    if (paddingLocal > 0) {
      this.intersectionBounds.expandByScalar(paddingLocal);
    }

    const blockedByOther =
      DoubleGrabController.activeController && DoubleGrabController.activeController !== this;
    const proximity = Math.max(0, this.options.proximity ?? 0);
    const proximityLocal = proximity / averageScale;
    const hasBounds = !this.intersectionBounds.isEmpty();

    const leftLocalPoint = leftPoint
      ? this.temp.leftLocal.copy(leftPoint).applyMatrix4(this.inverseMatrix)
      : null;
    const rightLocalPoint = rightPoint
      ? this.temp.rightLocal.copy(rightPoint).applyMatrix4(this.inverseMatrix)
      : null;

    const leftDistance = hasBounds && leftLocalPoint
      ? this.intersectionBounds.distanceToPoint(leftLocalPoint)
      : Infinity;
    const rightDistance = hasBounds && rightLocalPoint
      ? this.intersectionBounds.distanceToPoint(rightLocalPoint)
      : Infinity;

    const leftTouching = Boolean(
      !blockedByOther &&
        leftState?.visible &&
        leftLocalPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(leftLocalPoint) || leftDistance <= proximityLocal)
    );
    const rightTouching = Boolean(
      !blockedByOther &&
        rightState?.visible &&
        rightLocalPoint &&
        hasBounds &&
        (this.intersectionBounds.containsPoint(rightLocalPoint) || rightDistance <= proximityLocal)
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
controlRig.position.set(-0.78, 1.25, -1.05);
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
const controlPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.44), controlPanelMaterial);
controlPanel.position.set(0, 0, 0);
controlRig.add(controlPanel);

const controlPanelFrame = new THREE.Mesh(
  new THREE.PlaneGeometry(1.16, 0.48),
  new THREE.MeshBasicMaterial({ color: 0x031018, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
);
controlPanelFrame.position.set(0, 0, -0.01);
controlRig.add(controlPanelFrame);

const controlPanelOverlay = new ControlPanelOverlay();
controlRig.add(controlPanelOverlay.mesh);

const singlePressButton = new PanelButton({
  position: new THREE.Vector3(-0.45, -0.03, 0.06),
  baseColor: 0x3ab0ff,
  activeColor: 0xff7f9e,
  emissiveColor: 0x001c38,
  emissiveConfig: { idle: 0.45, ready: 0.95, activeScale: 1.05 },
  maxPressDepth: 0.045,
  activationThreshold: 0.95,
  releaseThreshold: 0.2
});
controlRig.add(singlePressButton.mesh);

const toggleButton = new PanelToggleButton({
  position: new THREE.Vector3(-0.15, -0.03, 0.06),
  offColor: 0xff5fa2,
  offActiveColor: 0xff8cc4,
  onColor: 0x4dffc3,
  onActiveColor: 0x8dffe0,
  emissiveColor: 0x3a001f,
  activationThreshold: 0.95,
  releaseThreshold: 0.35,
  onToggle: (toggled) => {
    const label = toggled ? 'ON' : 'OFF';
    controlPanelOverlay.update({ toggleStatus: label });
    systemMessages.unshift(`Toggle button: ${label}`);
    systemMessages.splice(12);
  }
});
controlRig.add(toggleButton.mesh);

const throttleLever = new ThrottleLeverControl({
  position: new THREE.Vector3(0.18, 0.12, 0.065),
  initialValue: 0.4
});
controlRig.add(throttleLever.group);

const rotarySelector = new RotarySelectorControl({
  position: new THREE.Vector3(0.5, 0.02, 0.06),
  labels: ['Apple', 'Banana', 'Cherry', 'Dragonfruit', 'Elderberry', 'Fig'],
  onSelectionChange: (label) => {
    controlPanelOverlay.update({ rotaryValue: label });
    systemMessages.unshift(`Selector set to: ${label}`);
    systemMessages.splice(12);
  }
});
controlRig.add(rotarySelector.group);

controlPanelOverlay.update({
  rotaryValue: rotarySelector.labels[rotarySelector.state.selectedIndex]
});

const controlRigController = new DoubleGrabController(controlRig, {
  proximity: 0.055,
  intersectionPadding: 0.03,
  minScale: 0.45,
  maxScale: 2.5,
  onReadyChange: (ready) => {
    controlPanelMaterial.emissiveIntensity = ready ? 0.9 : 0.35;
    singlePressButton.setReady(ready);
    toggleButton.setReady(ready);
    throttleLever.setReady(ready);
    rotarySelector.setReady(ready);
    controlPanelOverlay.update({ highlighted: ready });
  }
});

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

  const singlePressResult = singlePressButton.update(leftState, rightState, delta);
  const toggleResult = toggleButton.update(leftState, rightState, delta);
  const throttleResult = throttleLever.update(leftState, rightState, delta);
  const rotaryResult = rotarySelector.update(leftState, rightState, delta);

  const throttlePercent = Math.round(throttleResult.value * 100);
  const sliderValueText = throttleResult.activeHand
    ? `${throttlePercent}% · ${throttleResult.activeHand === 'L' ? 'Left' : 'Right'} hand`
    : `${throttlePercent}%`;
  const rotaryLabel = rotaryResult.selectedLabel ?? rotarySelector.labels[rotarySelector.state.selectedIndex];
  controlPanelOverlay.update({
    sliderValue: sliderValueText,
    toggleStatus: toggleResult.toggled ? 'ON' : 'OFF',
    rotaryValue: rotaryLabel
  });

  if (singlePressResult.justActivated) {
    systemMessages.unshift('Single press activated');
    systemMessages.splice(12);
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

  generalLines.push(
    `Single press ready: ${singlePressButton.state.ready ? 'YES' : 'no'}`,
    `Toggle button: ${toggleResult.toggled ? 'ON' : 'OFF'}`,
    `Throttle lever: ${throttlePercent}% (${throttleResult.value.toFixed(2)})`,
    `Gear selector: ${rotaryLabel}`
  );

  const statusLines = [];
  if (logRigStatus.grabbing) {
    statusLines.push('Adjusting log cluster…', `Scale ×${logRig.scale.x.toFixed(2)}`);
  }
  if (controlRigStatus.grabbing) {
    statusLines.push('Moving control panel…');
  }
  if (throttleResult.activeHand) {
    const throttleHandLabel = throttleResult.activeHand === 'L' ? 'left' : 'right';
    statusLines.push(`Adjusting throttle lever (${throttleHandLabel} hand)…`);
  }
  if (rotaryResult.grabbing) {
    statusLines.push('Rotating gear selector…');
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
