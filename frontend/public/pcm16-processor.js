class PCM16Writer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.sourceSampleRate = sampleRate; // provided by AudioWorklet global
    this._resampleFactor = this.sourceSampleRate / this.targetSampleRate;
  }

  // Simple resampler from Float32Array at sourceSampleRate to targetSampleRate
  _resampleTo16k(float32Mono) {
    if (this.sourceSampleRate === this.targetSampleRate) {
      return float32Mono;
    }

    const input = float32Mono;
    const inputLength = input.length;
    const outputLength = Math.floor(inputLength / this._resampleFactor);
    const output = new Float32Array(outputLength);

    // Linear interpolation
    let pos = 0;
    for (let i = 0; i < outputLength; i++) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[idx] || 0;
      const b = input[idx + 1] || a;
      output[i] = a + (b - a) * frac;
      pos += this._resampleFactor;
    }
    return output;
  }

  _floatToPCM16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      let s = float32[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Use first channel. If stereo, we only take channel 0.
    const channel0 = input[0];
    if (!channel0) return true;

    const resampled = this._resampleTo16k(channel0);
    const pcm16 = this._floatToPCM16(resampled);
    // Transferable ArrayBuffer for efficiency
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor('pcm16-writer', PCM16Writer);
