import * as THREE from 'three';

const buttonWorkVector = new THREE.Vector3();

export class PanelButton {
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
    metalness = 0.08,
    roughness = 0.85,
    flatShading = true
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
    geometry.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({
      color: this.colors.base.clone(),
      emissive: this.emissiveColor.clone(),
      emissiveIntensity: this.emissiveConfig.idle,
      metalness,
      roughness,
      flatShading,
      transparent: false,
      opacity: 1
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
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
