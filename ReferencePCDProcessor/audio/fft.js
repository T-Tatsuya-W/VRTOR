/**
 * Real-valued FFT implementation with persistent buffers to avoid
 * unnecessary allocations. Designed for streaming audio analysis.
 */
export class RealFFT {
  constructor() {
    this.size = 0;
    this.real = null;
    this.imag = null;
    this.magnitudes = null;
    this.bitRevTable = null;
  }

  /**
   * Ensures the internal buffers are sized for the requested FFT length.
   * @param {number} size - FFT size (power of two).
   */
  ensureSize(size) {
    if (this.size === size) return;
    this.size = size;
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    this.magnitudes = new Float32Array(size / 2);
    this.bitRevTable = new Uint32Array(size);

    let j = 0;
    for (let i = 1; i < size; i++) {
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      this.bitRevTable[i] = j;
    }
  }

  /**
   * Performs a real FFT on the provided signal. The internal buffers are
   * reused between calls to minimize garbage collection pressure.
   * @param {Float32Array} signal
   * @returns {Float32Array} A view into the internal magnitude buffer.
   */
  transform(signal) {
    let size = 1;
    while (size < signal.length) size <<= 1;
    this.ensureSize(size);

    this.real.fill(0);
    this.imag.fill(0);
    this.real.set(signal);

    // Bit reversal
    for (let i = 1; i < size; i++) {
      const j = this.bitRevTable[i];
      if (i < j) {
        [this.real[i], this.real[j]] = [this.real[j], this.real[i]];
        [this.imag[i], this.imag[j]] = [this.imag[j], this.imag[i]];
      }
    }

    // Iterative Cooley–Tukey FFT
    for (let len = 2; len <= size; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      for (let i = 0; i < size; i += len) {
        let wRe = 1;
        let wIm = 0;
        const halfLen = len >> 1;
        for (let k = 0; k < halfLen; k++) {
          const uRe = this.real[i + k];
          const uIm = this.imag[i + k];
          const vRe = this.real[i + k + halfLen] * wRe - this.imag[i + k + halfLen] * wIm;
          const vIm = this.real[i + k + halfLen] * wIm + this.imag[i + k + halfLen] * wRe;
          this.real[i + k] = uRe + vRe;
          this.imag[i + k] = uIm + vIm;
          this.real[i + k + halfLen] = uRe - vRe;
          this.imag[i + k + halfLen] = uIm - vIm;

          const nextWRe = wRe * wlenRe - wIm * wlenIm;
          const nextWIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nextWRe;
          wIm = nextWIm;
        }
      }
    }

    const half = size >> 1;
    for (let i = 0; i < half; i++) {
      this.magnitudes[i] = Math.hypot(this.real[i], this.imag[i]);
    }
    return this.magnitudes.subarray(0, half);
  }
}
