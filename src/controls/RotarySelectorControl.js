import * as THREE from 'three';
import { drawWrappedText } from '../utils/threeUtils.js';

export class RotarySelectorControl {
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

    context.fillStyle = '#ecf9ff';
    context.font = '700 110px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    drawWrappedText(context, label, canvas.width / 2, canvas.height / 2 - 40, 360, 110);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.faceTextureCache.set(key, texture);

    return texture;
  }

  refreshFaceTextures(selectedDirty) {
    this.faceMeshes.forEach((entry, index) => {
      const label = this.labels[index];
      const selected = index === this.state.selectedIndex;
      const texture = this.getFaceTexture(label, selected);
      if (selectedDirty || entry.material.map !== texture) {
        entry.material.map = texture;
        entry.material.needsUpdate = true;
      }
    });
  }

  updateHighlight(active) {
    this.barrelMaterial.emissiveIntensity = active ? 0.9 : 0.4;
    this.axleMaterial.emissiveIntensity = active ? 0.85 : 0.55;
    this.faceMeshes.forEach((entry, index) => {
      const selected = index === this.state.selectedIndex;
      entry.material.emissiveIntensity = selected ? (active ? 0.8 : 0.45) : active ? 0.45 : 0.25;
    });
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    if (!ready) {
      this.state.grabbedBy = null;
      this.state.lastGrabAngle = null;
    }
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

    this.group.updateWorldMatrix(true, false);

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
      this.refreshFaceTextures(true);
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
