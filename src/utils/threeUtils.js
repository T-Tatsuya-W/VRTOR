import * as THREE from 'three';

export function formatVec3(v) {
  return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
}

export function createLabelSprite(message, options = {}) {
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

export function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
  if (!text) {
    return y;
  }

  const words = `${text}`.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return y;
  }

  const { maxLines = Infinity, maxHeight = Infinity, ellipsis = true } = options ?? {};
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  const maxHeightLines = Number.isFinite(maxHeight) && lineHeight > 0
    ? Math.max(Math.floor(maxHeight / lineHeight), 0)
    : Infinity;
  const allowedLines = Math.min(lines.length, maxLines ?? Infinity, maxHeightLines);

  if (allowedLines === 0) {
    return y;
  }

  const truncated = allowedLines < lines.length && ellipsis;
  if (truncated) {
    const lastIndex = allowedLines - 1;
    let base = lines[lastIndex];
    const ellipsisChar = '…';
    while (base.length > 0 && ctx.measureText(`${base}${ellipsisChar}`).width > maxWidth) {
      base = base.slice(0, -1);
    }
    lines[lastIndex] = `${base}${ellipsisChar}`;
  }

  let cursorY = y;
  for (let index = 0; index < allowedLines; index += 1) {
    ctx.fillText(lines[index], x, cursorY);
    cursorY += lineHeight;
  }

  return cursorY;
}
