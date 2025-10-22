import * as THREE from 'three';
import { DoubleGrabController } from '../interactions/DoubleGrabController.js';

export class SoundPanel {
  constructor({
    position = new THREE.Vector3(0, 0.95, -1.32),
    rotation = new THREE.Euler(0, 0, 0),
    header = 'Sound Monitor',
    historyLength = 120
  } = {}) {
    this.group = new THREE.Group();
    if (position instanceof THREE.Vector3) {
      this.group.position.copy(position);
    } else if (Array.isArray(position)) {
      this.group.position.fromArray(position);
    } else if (position && typeof position === 'object') {
      this.group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }
    if (rotation instanceof THREE.Euler) {
      this.group.rotation.copy(rotation);
    } else if (Array.isArray(rotation)) {
      this.group.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
    } else if (rotation && typeof rotation === 'object') {
      this.group.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    }

    this.header = header;
    this.historyLength = Math.max(2, Math.floor(historyLength));
    this.history = new Array(this.historyLength).fill(0);
    this.state = {
      ready: false,
      status: 'Initializing microphone…',
      statusType: 'info',
      level: 0,
      rms: 0
    };
    this.dirty = true;

    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x132f41,
      emissive: 0x0b3c57,
      emissiveIntensity: 0.48,
      metalness: 0.25,
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.66), this.panelMaterial);
    this.group.add(this.panelMesh);

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x050f16,
      emissive: 0x050f16,
      emissiveIntensity: 0.3,
      metalness: 0.25,
      roughness: 0.7,
      side: THREE.DoubleSide
    });
    this.frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), frameMaterial);
    this.frameMesh.position.set(0, 0, -0.012);
    this.group.add(this.frameMesh);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 432;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const graphMaterial = new THREE.MeshBasicMaterial({ map: this.texture });
    graphMaterial.depthTest = false;
    graphMaterial.depthWrite = false;
    this.graphMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.62), graphMaterial);
    this.graphMesh.position.set(0, 0, 0.004);
    this.graphMesh.renderOrder = 15;
    this.group.add(this.graphMesh);

    this.controller = new DoubleGrabController(this.group, {
      proximity: 0.055,
      intersectionPadding: 0.03,
      minScale: 0.5,
      maxScale: 2.2,
      onReadyChange: (ready) => this.setReady(ready)
    });

    this.render();
  }

  setReady(ready) {
    if (this.state.ready === ready) return;
    this.state.ready = ready;
    this.panelMaterial.emissiveIntensity = ready ? 0.95 : 0.45;
    this.invalidate();
  }

  setStatus(status, { type = 'info' } = {}) {
    const nextType = type === 'error' ? 'error' : 'info';
    if (this.state.status === status && this.state.statusType === nextType) {
      return;
    }
    this.state.status = status;
    this.state.statusType = nextType;
    this.invalidate();
  }

  updateMeter({ level = 0, rms = 0 } = {}) {
    const clampedLevel = Math.min(Math.max(level, 0), 1);
    this.history.push(clampedLevel);
    if (this.history.length > this.historyLength) {
      this.history.shift();
    }
    this.state.level = clampedLevel;
    this.state.rms = Math.max(0, rms);
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
    this.render();
  }

  update(leftState, rightState) {
    return this.controller.update(leftState, rightState);
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;

    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const ready = this.state.ready;
    ctx.fillStyle = ready ? '#073545' : '#071824';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = ready ? '#00ffcc' : '#0f3a44';
    ctx.lineWidth = ready ? 12 : 6;
    ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

    ctx.fillStyle = '#d1f8ff';
    ctx.font = '700 60px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.header, 48, 42);

    ctx.font = '500 30px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.fillStyle = this.state.statusType === 'error' ? '#ff9ebd' : '#f1f6ff';
    ctx.fillText(this.state.status, 48, 120);

    const graphLeft = 60;
    const graphTop = 170;
    const graphWidth = canvas.width - graphLeft * 2;
    const graphHeight = 200;

    ctx.fillStyle = '#0a2431';
    ctx.fillRect(graphLeft, graphTop, graphWidth, graphHeight);

    ctx.strokeStyle = '#134d4c';
    ctx.lineWidth = 2;
    const horizontalDivisions = 4;
    for (let i = 1; i < horizontalDivisions; i += 1) {
      const y = graphTop + (graphHeight / horizontalDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(graphLeft, y);
      ctx.lineTo(graphLeft + graphWidth, y);
      ctx.stroke();
    }

    const points = this.history;
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((value, index) => {
        const x = graphLeft + (graphWidth * index) / (points.length - 1);
        const y = graphTop + graphHeight - value * graphHeight;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo(graphLeft + graphWidth, graphTop + graphHeight);
      ctx.lineTo(graphLeft, graphTop + graphHeight);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 255, 204, 0.3)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#00ffcc';
      ctx.stroke();
    }

    const percent = Math.round(this.state.level * 100);
    ctx.fillStyle = '#00ffcc';
    ctx.font = '600 40px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.fillText(`Level: ${percent}%`, 48, graphTop + graphHeight + 36);

    ctx.fillStyle = '#d2ebff';
    ctx.font = '500 30px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.fillText(`RMS: ${this.state.rms.toFixed(3)}`, 320, graphTop + graphHeight + 36);

    this.texture.needsUpdate = true;
  }
}
