import { hannWindow } from './windowing.js';
import { RealFFT } from './fft.js';
import { PitchClassComputer } from './pcd.js';
import { estimatePrimary } from './primary-detection.js';

const WORKLET_SOURCE = `
  class Tap extends AudioWorkletProcessor {
    process(inputs) {
      const ch = inputs[0][0];
      if (ch) {
        this.port.postMessage(ch.slice(0));
      }
      return true;
    }
  }
  registerProcessor('tap', Tap);
`;

let workletUrl = null;
function getWorkletUrl() {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
  }
  return workletUrl;
}

function frameRms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

function toPowerOfTwo(value) {
  const clamped = Math.max(32, value | 0);
  const exponent = Math.round(Math.log2(clamped));
  return 1 << Math.max(5, exponent); // Ensure at least 32 samples
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const DEFAULT_AUDIO_CONFIG = {
  windowSize: 16384,
  hopSize: 1024,
  minHz: 50,
  maxHz: 5000,
  smoothing: 0.6,
  pcdMinRms: 0.001,
  pcdThreshold: 0.005,
  pcdNormalize: 1.0,
  refA4: 440,
};

export const DEFAULT_TUNER_CONFIG = {
  enabled: true,
  minHz: 70,
  maxHz: 1800,
  minProminence: 6.0,
  minRMS: 0.003,
  reactivity: 0.35,
};

/**
 * AudioProcessor encapsulates microphone capture, FFT analysis and pitch class
 * computation. It dispatches `analysis` events with the current frame data so
 * UI or other systems can consume the results without dealing with the audio
 * plumbing.
 */
export class AudioProcessor extends EventTarget {
  constructor(config = {}) {
    super();

    const { tuner, ...audioConfig } = config;
    this.config = { ...DEFAULT_AUDIO_CONFIG, ...audioConfig };
    this.tunerConfig = { ...DEFAULT_TUNER_CONFIG, ...(tuner || {}) };

    this.audioContext = null;
    this.mediaStreamSource = null;
    this.silentGain = null;
    this.workletNode = null;
    this.micStream = null;
    this.sampleRate = 48000;
    this.running = false;

    this.fft = new RealFFT();
    this.pcdComputer = new PitchClassComputer();

    this.windowFn = hannWindow(this.config.windowSize);
    this.ringBuffer = new Float32Array(this.config.windowSize);
    this.analysisBuffer = new Float32Array(this.config.windowSize);
    this.writeIndex = 0;
    this.filled = 0;
    this.hopCounter = 0;

    this.currentPcd = new Float32Array(12);
    this.rawPcd = new Float32Array(12);
    this.lastRms = 0;

    this.handleAudioFrame = this.handleAudioFrame.bind(this);
  }

  getCurrentPcd() {
    return this.currentPcd;
  }

  getSampleRate() {
    return this.sampleRate;
  }

  getLastRms() {
    return this.lastRms;
  }

  isRunning() {
    return this.running;
  }

  updateConfig(updates = {}) {
    if (typeof updates !== 'object') return;

    const cfg = this.config;
    let reinitWindow = false;

    if (updates.windowSize && updates.windowSize !== cfg.windowSize) {
      const size = toPowerOfTwo(updates.windowSize);
      if (size !== cfg.windowSize) {
        cfg.windowSize = size;
        this.windowFn = hannWindow(size);
        this.ringBuffer = new Float32Array(size);
        this.analysisBuffer = new Float32Array(size);
        reinitWindow = true;
      }
    }

    if (updates.hopSize) {
      cfg.hopSize = Math.max(1, updates.hopSize | 0);
    }

    if (updates.minHz !== undefined) {
      cfg.minHz = Math.max(0, updates.minHz);
    }
    if (updates.maxHz !== undefined) {
      cfg.maxHz = Math.max(cfg.minHz + 1, updates.maxHz);
    }
    if (cfg.maxHz <= cfg.minHz) {
      cfg.maxHz = cfg.minHz + 1;
    }

    if (updates.smoothing !== undefined) {
      cfg.smoothing = clamp(updates.smoothing, 0, 0.999);
    }
    if (updates.pcdMinRms !== undefined) {
      cfg.pcdMinRms = Math.max(0, updates.pcdMinRms);
    }
    if (updates.pcdThreshold !== undefined) {
      cfg.pcdThreshold = Math.max(0, updates.pcdThreshold);
    }
    if (updates.pcdNormalize !== undefined) {
      cfg.pcdNormalize = Math.max(0.1, updates.pcdNormalize);
    }
    if (updates.refA4 !== undefined) {
      cfg.refA4 = Math.max(1, updates.refA4);
    }

    if (reinitWindow) {
      this.resetBuffers();
    }

    cfg.hopSize = Math.min(cfg.hopSize, cfg.windowSize);
  }

  updateTuner(updates = {}) {
    if (typeof updates !== 'object') return;
    Object.assign(this.tunerConfig, updates);
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error('Microphone access is not supported in this environment.');
      this.dispatchError(error);
      throw error;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
      this.sampleRate = this.audioContext.sampleRate;
      await this.audioContext.audioWorklet.addModule(getWorkletUrl());

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });

      this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.micStream);
      this.silentGain = this.audioContext.createGain();
      this.silentGain.gain.value = 0;
      this.workletNode = new AudioWorkletNode(this.audioContext, 'tap');

      this.mediaStreamSource.connect(this.workletNode).connect(this.silentGain).connect(this.audioContext.destination);
      this.workletNode.port.onmessage = this.handleAudioFrame;

      this.resetBuffers();
      this.setRunning(true);
    } catch (error) {
      await this.stop();
      this.dispatchError(error);
      throw error;
    }
  }

  async stop() {
    if (!this.running && !this.audioContext && !this.micStream) return;

    this.setRunning(false);

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }

    if (this.silentGain) {
      try { this.silentGain.disconnect(); } catch {}
      this.silentGain = null;
    }

    if (this.mediaStreamSource) {
      try { this.mediaStreamSource.disconnect(); } catch {}
      this.mediaStreamSource = null;
    }

    if (this.micStream) {
      try {
        const tracks = this.micStream.getTracks();
        tracks.forEach(track => track.stop());
      } catch {}
      this.micStream = null;
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.resetBuffers();
  }

  handleAudioFrame(event) {
    if (!this.running) return;
    const frame = event.data;
    const windowSize = this.config.windowSize;

    for (let i = 0; i < frame.length; i++) {
      this.ringBuffer[this.writeIndex++] = frame[i];
      if (this.writeIndex >= windowSize) this.writeIndex = 0;
      if (this.filled < windowSize) this.filled++;
      this.hopCounter++;
      if (this.hopCounter >= this.config.hopSize && this.filled >= windowSize) {
        this.hopCounter = 0;
        this.processFrame();
      }
    }
  }

  processFrame() {
    if (!this.running) return;
    try {
      const windowSize = this.config.windowSize;
      const start = this.writeIndex % windowSize;
      const first = this.ringBuffer.subarray(start);
      this.analysisBuffer.set(first, 0);
      if (start > 0) {
        this.analysisBuffer.set(this.ringBuffer.subarray(0, start), first.length);
      }

      const windowFn = this.windowFn;
      for (let i = 0; i < windowSize; i++) {
        this.analysisBuffer[i] *= windowFn[i];
      }

      const rms = frameRms(this.analysisBuffer);
      this.lastRms = rms;

      const magnitudes = this.fft.transform(this.analysisBuffer);

      let rawPcd;
      if (rms >= this.config.pcdMinRms) {
        rawPcd = this.pcdComputer.compute(magnitudes, this.sampleRate, this.config);
      } else {
        rawPcd = this.pcdComputer.getSilentOutput();
      }
      this.rawPcd.set(rawPcd);

      const smoothing = clamp(this.config.smoothing, 0, 0.999);
      const beta = 1 - smoothing;
      for (let i = 0; i < 12; i++) {
        this.currentPcd[i] = smoothing * this.currentPcd[i] + beta * this.rawPcd[i];
      }

      let primary = null;
      if (this.tunerConfig.enabled && rms >= this.tunerConfig.minRMS) {
        const est = estimatePrimary(magnitudes, this.sampleRate, this.tunerConfig.minHz, this.tunerConfig.maxHz);
        if (est && est.prominenceDb >= this.tunerConfig.minProminence) {
          const midiReal = 69 + 12 * Math.log2(est.freq / this.config.refA4);
          const nearest = Math.round(midiReal);
          const cents = (midiReal - nearest) * 100;
          const pitchClass = ((nearest % 12) + 12) % 12;
          primary = {
            freq: est.freq,
            prominenceDb: est.prominenceDb,
            cents,
            pitchClass,
            nearestMidi: nearest,
            midi: midiReal,
          };
        }
      }

      const detail = {
        pcd: this.currentPcd,
        rawPcd: this.rawPcd,
        rms,
        magnitudes,
        primary,
        sampleRate: this.sampleRate,
        audioTime: this.audioContext ? this.audioContext.currentTime : null,
      };
      this.dispatchEvent(new CustomEvent('analysis', { detail }));
    } catch (error) {
      this.dispatchError(error);
    }
  }

  resetBuffers() {
    this.writeIndex = 0;
    this.filled = 0;
    this.hopCounter = 0;
    this.ringBuffer.fill(0);
    this.analysisBuffer.fill(0);
    this.currentPcd.fill(0);
    this.rawPcd.fill(0);
    this.lastRms = 0;
  }

  setRunning(value) {
    if (this.running === value) return;
    this.running = value;
    this.dispatchEvent(new CustomEvent('statechange', { detail: { running: value } }));
  }

  dispatchError(error) {
    this.dispatchEvent(new CustomEvent('error', { detail: error }));
  }
}
