/**
 * Forward DFT: Convert 12-bin PCD values to amplitude/phase representation.
 * Accepts standard arrays or typed arrays and returns Float32Array results.
 *
 * @param {ArrayLike<number>} pcdValues - 12-element collection of PCD weights.
 * @returns {{ amplitudes: Float32Array, phases: Float32Array, normalizedInput: Float32Array }}
 */
export function pcdToFrequencyDomain(pcdValues) {
  let values;
  if (Array.isArray(pcdValues) || ArrayBuffer.isView(pcdValues)) {
    values = pcdValues;
  } else {
    throw new Error('Input must be an array-like collection of 12 values');
  }

  if (values.length !== 12) {
    throw new Error('Input must contain exactly 12 pitch-class values');
  }

  const normalized = new Float32Array(12);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += values[i];
  }
  if (sum === 0) {
    normalized.fill(0);
  } else {
    const inv = 1 / sum;
    for (let i = 0; i < 12; i += 1) {
      normalized[i] = values[i] * inv;
    }
  }

  const amplitudes = new Float32Array(7);
  const phases = new Float32Array(7);
  const N = 12;
  for (let k = 0; k < amplitudes.length; k += 1) {
    let re = 0;
    let im = 0;
    const base = (-2 * Math.PI * k) / N;
    for (let t = 0; t < N; t += 1) {
      const angle = base * t;
      const value = normalized[t];
      re += value * Math.cos(angle);
      im += value * Math.sin(angle);
    }
    amplitudes[k] = Math.hypot(re, im);
    phases[k] = Math.atan2(im, re);
  }

  return { amplitudes, phases, normalizedInput: normalized };
}
