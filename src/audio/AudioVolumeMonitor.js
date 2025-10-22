import * as THREE from 'three';

export class AudioVolumeMonitor {
  constructor({ fftSize = 1024, smoothing = 0.7, normalization = 4 } = {}) {
    this.options = {
      fftSize,
      smoothing: THREE.MathUtils.clamp(smoothing, 0, 0.99),
      normalization: normalization > 0 ? normalization : 4
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

      this.audioContext = new AudioContextConstructor();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.options.fftSize;
      this.dataArray = new Float32Array(this.analyser.fftSize);
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
    if (this.state.status !== 'active' || !this.analyser || !this.dataArray) {
      return { level: 0, rms: 0 };
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
    const smoothing = this.options.smoothing;

    this.state.level = smoothing * this.state.level + (1 - smoothing) * normalized;
    this.state.rms = smoothing * this.state.rms + (1 - smoothing) * rms;

    return { level: this.state.level, rms: this.state.rms };
  }
}
