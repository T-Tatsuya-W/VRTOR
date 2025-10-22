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

export function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
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
