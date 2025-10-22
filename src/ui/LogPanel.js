import * as THREE from 'three';

export class LogPanel {
  constructor(title, { width = 1.05, height = 0.55 } = {}) {
    this.title = title;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
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
    ctx.fillStyle = this.highlighted ? '#073545' : '#050b11';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.highlighted) {
      ctx.strokeStyle = '#00ffcc';
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
