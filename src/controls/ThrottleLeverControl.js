import * as THREE from 'three';

export class ThrottleLeverControl {
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

    this.handleMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d8f9e,
      emissive: 0x032a34,
      emissiveIntensity: 0.8,
      metalness: 0.55,
      roughness: 0.32,
      transparent: true,
      opacity: 0.96
    });

    const track = new THREE.Mesh(new THREE.BoxGeometry(0.12, maxPosition - minPosition + 0.2, 0.05), this.trackMaterial);
    track.position.set(0, (minPosition + maxPosition) / 2, 0);
    track.castShadow = true;
    track.receiveShadow = true;
    this.group.add(track);

    this.handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.1), this.handleMaterial);
    this.handle.position.set(0, THREE.MathUtils.lerp(minPosition, maxPosition, initialValue), 0);
    this.handle.castShadow = true;
    this.handle.receiveShadow = true;
    this.group.add(this.handle);

    const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    const indicator = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.1), indicatorMaterial);
    indicator.position.set(0.12, 0, 0.051);
    this.group.add(indicator);

    this.state = {
      ready: false,
      currentValue: THREE.MathUtils.clamp(initialValue, 0, 1),
      targetValue: THREE.MathUtils.clamp(initialValue, 0, 1),
      minPosition,
      maxPosition,
      grabPadding,
      damping,
      grabbedBy: null,
      grabOffset: 0,
      bounding: new THREE.Box3(),
      paddedBounding: new THREE.Box3()
    };
    this.onValueChange = onValueChange;
    this.workVector = new THREE.Vector3();
    this.lastReportedValue = this.state.currentValue;
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    if (!ready) {
      this.state.grabbedBy = null;
      this.state.grabOffset = 0;
    }
  }

  setValue(value) {
    const clamped = THREE.MathUtils.clamp(value, 0, 1);
    this.state.currentValue = clamped;
    this.state.targetValue = clamped;
  }

  getValueFromLocalY(y) {
    const { minPosition, maxPosition } = this.state;
    return THREE.MathUtils.clamp((y - minPosition) / (maxPosition - minPosition), 0, 1);
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
