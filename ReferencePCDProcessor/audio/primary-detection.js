/**
 * Estimates the dominant peak in the magnitude spectrum within a frequency
 * range. Returns null if the signal is too weak.
 * @param {Float32Array} magnitudes
 * @param {number} sampleRate
 * @param {number} minHz
 * @param {number} maxHz
 * @returns {{freq:number,kRef:number,prominenceDb:number}|null}
 */
export function estimatePrimary(magnitudes, sampleRate, minHz, maxHz) {
  const halfSize = magnitudes.length;
  const binHz = sampleRate / (halfSize * 2);
  const kMin = Math.max(2, Math.floor(minHz / binHz));
  const kMax = Math.min(halfSize - 3, Math.floor(maxHz / binHz));

  let maxVal = 0;
  let k = kMin;
  for (let i = kMin; i <= kMax; i++) {
    const value = magnitudes[i];
    if (value > maxVal) {
      maxVal = value;
      k = i;
    }
  }

  if (maxVal < 1e-6) return null;

  const neighborhood = 10;
  const from = Math.max(kMin, k - neighborhood);
  const to = Math.min(kMax, k + neighborhood);

  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i += 2) {
    if (i !== k) {
      sum += magnitudes[i];
      count++;
    }
  }

  const avgNeighbor = count > 0 ? sum / count : 0;
  const prominenceDb = avgNeighbor > 0
    ? 20 * Math.log10((maxVal + 1e-12) / (avgNeighbor + 1e-12))
    : 0;

  const a = magnitudes[k - 1];
  const b = magnitudes[k];
  const c = magnitudes[k + 1];
  const denom = (a - 2 * b + c) || 1e-12;
  const delta = 0.5 * (a - c) / denom;
  const kRef = k + Math.max(-1, Math.min(1, delta));
  const freq = kRef * binHz;

  return { freq, kRef, prominenceDb };
}
