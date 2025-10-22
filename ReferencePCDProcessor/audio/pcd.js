/**
 * Utility responsible for converting FFT magnitudes into a 12-bin pitch class
 * distribution. The implementation caches the bin→pitch-class mapping and
 * reuses the output buffer between frames to avoid allocations.
 */
export class PitchClassComputer {
  constructor() {
    this.lookupTable = null;
    this.prevSampleRate = 0;
    this.prevA4 = 0;
    this.prevLength = 0;
    this.output = new Float32Array(12);
    this.zero = new Float32Array(12);
  }

  ensureLookup(length, sampleRate, a4) {
    if (
      this.lookupTable &&
      this.prevSampleRate === sampleRate &&
      this.prevA4 === a4 &&
      this.prevLength === length
    ) {
      return;
    }

    this.prevSampleRate = sampleRate;
    this.prevA4 = a4;
    this.prevLength = length;

    this.lookupTable = new Uint8Array(length);
    const binHz = sampleRate / (length * 2);
    const log2A4 = Math.log2(a4);

    for (let k = 0; k < length; k++) {
      const freq = k * binHz;
      if (freq > 0) {
        const midi = 69 + 12 * (Math.log2(freq) - log2A4);
        this.lookupTable[k] = ((Math.round(midi) % 12) + 12) % 12;
      } else {
        this.lookupTable[k] = 0;
      }
    }
  }

  /**
   * Computes the pitch-class distribution for the provided magnitudes.
   * @param {Float32Array} magnitudes - FFT magnitudes.
   * @param {number} sampleRate
   * @param {object} options
   * @param {number} options.minHz
   * @param {number} options.maxHz
   * @param {number} options.pcdThreshold
   * @param {number} options.pcdNormalize
   * @param {number} options.refA4
   * @returns {Float32Array} Reference to the internal output buffer.
   */
  compute(magnitudes, sampleRate, options) {
    const { minHz, maxHz, pcdThreshold, pcdNormalize, refA4 } = options;
    this.ensureLookup(magnitudes.length, sampleRate, refA4);

    this.output.fill(0);

    const binHz = sampleRate / (magnitudes.length * 2);
    const minBin = Math.max(1, Math.floor(minHz / binHz));
    const maxBin = Math.min(magnitudes.length - 1, Math.floor(maxHz / binHz));

    for (let k = minBin; k <= maxBin; k++) {
      const mag = magnitudes[k];
      if (mag > pcdThreshold) {
        const pitchClass = this.lookupTable[k];
        this.output[pitchClass] += mag * mag;
      }
    }

    let sum = 0;
    if (pcdNormalize !== 1) {
      for (let i = 0; i < 12; i++) {
        this.output[i] = Math.pow(this.output[i], pcdNormalize);
        sum += this.output[i];
      }
    } else {
      for (let i = 0; i < 12; i++) {
        sum += this.output[i];
      }
    }

    if (sum > 0) {
      const inv = 1 / sum;
      for (let i = 0; i < 12; i++) {
        this.output[i] *= inv;
      }
    }

    return this.output;
  }

  /**
   * Returns a zeroed PCD buffer, useful when skipping analysis for silent
   * frames without re-allocating.
   */
  getSilentOutput() {
    this.zero.fill(0);
    return this.zero;
  }
}
