const windowCache = new Map();

/**
 * Returns a cached Hann window of the requested size.
 * Uses a internal cache to avoid repeated allocations and math.
 * @param {number} size
 * @returns {Float32Array}
 */
export function hannWindow(size) {
  if (windowCache.has(size)) {
    return windowCache.get(size);
  }
  const window = new Float32Array(size);
  const factor = 2 * Math.PI / (size - 1);
  for (let n = 0; n < size; n++) {
    window[n] = 0.5 * (1 - Math.cos(factor * n));
  }
  windowCache.set(size, window);
  return window;
}

/**
 * Clears all cached window functions. Useful when freeing memory
 * or when running in constrained environments.
 */
export function clearWindowCache() {
  windowCache.clear();
}
