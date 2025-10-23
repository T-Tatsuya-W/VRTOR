import * as THREE from 'three';
import { PitchClassComputer } from './PitchClassComputer.js';
import { pcdToFrequencyDomain } from './pcdDft.js';

const DEFAULT_PCD_OPTIONS = {
  minHz: 50,
  maxHz: 5000,
  pcdThreshold: 0.005,
  pcdNormalize: 1.0,
  refA4: 440,
  minRms: 0.001
};

const DEFAULT_FFT_SIZE = 16384;
const DEFAULT_SMOOTHING = 0.6;

const MIN_FFT_SIZE = 32;
const MAX_FFT_SIZE = 32768;

function sanitizeFftSize(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_FFT_SIZE;
  }
  const clamped = Math.min(MAX_FFT_SIZE, Math.max(MIN_FFT_SIZE, Math.floor(value)));
  const exponent = Math.round(Math.log2(clamped));
  const size = 2 ** Math.min(Math.max(exponent, 5), 15);
  return Math.min(MAX_FFT_SIZE, Math.max(MIN_FFT_SIZE, size));
}

function normalizePcdOptions(options) {
  const normalized = { ...DEFAULT_PCD_OPTIONS, ...(options || {}) };
  normalized.minHz = Math.max(0, normalized.minHz);
  normalized.maxHz = Math.max(normalized.minHz + 1, normalized.maxHz);
  normalized.pcdThreshold = Math.max(0, normalized.pcdThreshold);
  normalized.pcdNormalize = Math.max(0.1, normalized.pcdNormalize);
  normalized.refA4 = Math.max(1, normalized.refA4);
  normalized.minRms = Math.max(0, normalized.minRms);
  return normalized;
}

export class AudioVolumeMonitor {
  constructor({ fftSize = DEFAULT_FFT_SIZE, smoothing = DEFAULT_SMOOTHING, normalization = 4, pcdOptions = {} } = {}) {
    const sanitizedFftSize = sanitizeFftSize(fftSize);
    const smoothingValue = THREE.MathUtils.clamp(
      Number.isFinite(smoothing) ? smoothing : DEFAULT_SMOOTHING,
      0,
      0.99
    );
    this.options = {
      fftSize: sanitizedFftSize,
      smoothing: smoothingValue,
      normalization: normalization > 0 ? normalization : 4,
      pcd: normalizePcdOptions(pcdOptions)
    };
    this.state = {
      status: 'idle',
      level: 0,
      rms: 0,
      error: null
    };
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.dataArray = null;
    this.frequencyData = null;
    this.magnitudeData = null;
    this.sampleRate = 44100;

    this.pitchComputer = new PitchClassComputer();
    this.pcdValues = new Float32Array(12);
    this.rawPcdValues = new Float32Array(12);
    this.dftAmplitudes = new Float32Array(7);
    this.dftPhases = new Float32Array(7);
  }

  getStatus() {
    return this.state.status;
  }

  getErrorMessage() {
    return this.state.error ? this.state.error.message ?? String(this.state.error) : null;
  }

  getStatusDescription() {
    switch (this.state.status) {
      case 'pending':
        return 'awaiting permission';
      case 'active':
        return 'active';
      case 'error':
        return this.getErrorMessage() ? `error: ${this.getErrorMessage()}` : 'error';
      default:
        return 'idle';
    }
  }

  async start() {
    if (this.state.status === 'active' || this.state.status === 'pending') {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.status = 'error';
      this.state.error = new Error('Microphone access is not supported in this browser');
      throw this.state.error;
    }

    this.state.status = 'pending';

    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('Web Audio API is not available');
      }

      this.audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
      this.sampleRate = this.audioContext.sampleRate;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      this.stream = stream;
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.options.fftSize;
      this.analyser.smoothingTimeConstant = 0;
      this.dataArray = new Float32Array(this.analyser.fftSize);
      this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      this.magnitudeData = new Float32Array(this.analyser.frequencyBinCount);
      this.source.connect(this.analyser);
      this.state.status = 'active';
      this.state.error = null;
    } catch (error) {
      this.state.status = 'error';
      this.state.error = error instanceof Error ? error : new Error(String(error));
      throw this.state.error;
    }
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        if (!this.state.error) {
          this.state.error = error instanceof Error ? error : new Error(String(error));
        }
      }
    }
  }

  update() {
    if (this.state.status !== 'active' || !this.analyser || !this.dataArray || !this.frequencyData) {
      this.pcdValues.fill(0);
      this.rawPcdValues.fill(0);
      this.dftAmplitudes.fill(0);
      this.dftPhases.fill(0);
      return {
        level: 0,
        rms: 0,
        pcd: this.pcdValues,
        dft: { amplitudes: this.dftAmplitudes, phases: this.dftPhases }
      };
    }

    if (this.audioContext?.state === 'suspended') {
      this.resume();
    }

    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sumSquares = 0;
    for (let i = 0; i < this.dataArray.length; i += 1) {
      const sample = this.dataArray[i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / this.dataArray.length);
    const normalized = Math.min(1, rms * this.options.normalization);
    const meterSmoothing = this.options.smoothing;

    this.state.level = meterSmoothing * this.state.level + (1 - meterSmoothing) * normalized;
    this.state.rms = meterSmoothing * this.state.rms + (1 - meterSmoothing) * rms;

    const pcdOptions = this.options.pcd;
    let rawPcd;
    if (this.state.rms >= pcdOptions.minRms) {
      this.analyser.getFloatFrequencyData(this.frequencyData);
      const len = this.frequencyData.length;
      for (let i = 0; i < len; i += 1) {
        const db = this.frequencyData[i];
        if (!Number.isFinite(db) || db <= -160) {
          this.magnitudeData[i] = 0;
        } else {
          this.magnitudeData[i] = Math.pow(10, db / 20);
        }
      }
      this.sampleRate = this.audioContext?.sampleRate ?? this.sampleRate;
      rawPcd = this.pitchComputer.compute(this.magnitudeData, this.sampleRate, pcdOptions);
    } else {
      this.rawPcdValues.fill(0);
      rawPcd = this.rawPcdValues;
    }

    if (rawPcd) {
      this.rawPcdValues.set(rawPcd);
      const pcdSmoothing = THREE.MathUtils.clamp(this.options.smoothing, 0, 0.999);
      if (pcdSmoothing === 0) {
        this.pcdValues.set(this.rawPcdValues);
      } else {
        const blend = 1 - pcdSmoothing;
        for (let i = 0; i < this.pcdValues.length; i += 1) {
          this.pcdValues[i] = pcdSmoothing * this.pcdValues[i] + blend * this.rawPcdValues[i];
        }
      }
      const dft = pcdToFrequencyDomain(this.pcdValues);
      this.dftAmplitudes.set(dft.amplitudes);
      this.dftPhases.set(dft.phases);
    } else {
      this.pcdValues.fill(0);
      this.dftAmplitudes.fill(0);
      this.dftPhases.fill(0);
    }

    return {
      level: this.state.level,
      rms: this.state.rms,
      pcd: this.pcdValues,
      dft: {
        amplitudes: this.dftAmplitudes,
        phases: this.dftPhases
      }
    };
  }
}
