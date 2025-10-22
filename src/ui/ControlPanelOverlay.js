import * as THREE from 'three';
import { drawWrappedText } from '../utils/threeUtils.js';

export class ControlPanelOverlay {
  constructor({ width = 1.08, height = 0.44 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.position.set(0, 0, 0.002);
    this.mesh.renderOrder = 20;
    this.state = {
      header: 'Controls',
      highlighted: false,
      columns: []
    };
    this.render();
  }

  update(nextState = {}) {
    const columns = Array.isArray(nextState.columns)
      ? nextState.columns.map((column) => ({ ...column }))
      : this.state.columns;
    const header = nextState.header ?? this.state.header;
    const highlighted = nextState.highlighted ?? this.state.highlighted;

    const changed =
      header !== this.state.header ||
      highlighted !== this.state.highlighted ||
      columns.length !== this.state.columns.length ||
      columns.some((column, index) => {
        const prev = this.state.columns[index];
        if (!prev) return true;
        return (
          column.title !== prev.title ||
          column.valueLabel !== prev.valueLabel ||
          column.value !== prev.value ||
          column.hint !== prev.hint ||
          column.accent !== prev.accent
        );
      });

    if (!changed) {
      return;
    }

    this.state = { header, highlighted, columns };
    this.render();
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = this.state.highlighted ? '#073545' : '#050b11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.state.highlighted) {
      ctx.strokeStyle = '#00ffcc';
      ctx.lineWidth = 12;
      ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    }

    ctx.fillStyle = '#00ffcc';
    ctx.font = '600 48px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.state.header, 32, 32);

    const columns = Array.isArray(this.state.columns) ? this.state.columns : [];
    if (columns.length === 0) {
      this.texture.needsUpdate = true;
      return;
    }

    const columnWidth = (canvas.width - 64) / columns.length;
    const contentTop = 72;
    const bottomPadding = 120;
    const columnHeight = canvas.height - contentTop - bottomPadding;

    columns.forEach((column, index) => {
      const x = 32 + columnWidth * index;
      const cardX = x + 8;
      const cardY = contentTop - 32;
      const cardWidth = columnWidth - 16;
      const cardHeight = columnHeight + 32;
      const accentColor = column.accent ?? '#00ffcc';
      const textX = cardX + 18;

      ctx.fillStyle = 'rgba(8, 26, 38, 0.94)';
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 4;
      ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

      ctx.fillStyle = accentColor;
      ctx.fillRect(cardX, cardY, 6, cardHeight);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f1f6ff';
      ctx.font = '600 34px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillText(column.title, textX, contentTop);

      ctx.font = '600 30px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillStyle = accentColor;
      const line = `${column.valueLabel ?? 'Value'}: ${column.value ?? '—'}`;
      ctx.fillText(line, textX, contentTop + 48);

      ctx.font = '500 24px "Fira Mono", "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.fillStyle = '#d2ebff';
      const hintTop = contentTop + 80;
      const hintHeight = Math.max(columnHeight - 80, 0);
      drawWrappedText(
        ctx,
        column.hint ?? '',
        textX,
        hintTop,
        Math.max(cardWidth - 36, 0),
        30,
        {
          maxHeight: hintHeight,
          maxLines: 3
        }
      );
    });

    this.texture.needsUpdate = true;
  }
}
