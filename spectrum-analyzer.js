/**
 * SpectrumAnalyzer64
 * ------------------
 * The shared 64-band spectrum extraction engine for SoundScope + ScoreForge.
 *
 * ARCHITECTURE NOTE (fixes the v1.3.4 bug):
 * The native Web Audio AnalyserNode must NEVER sit in the main signal path
 * as a routing hub. It is used strictly as a TAP: audio is connected INTO
 * it, but its own output is never connected onward to anything. If you
 * route through it, you couple metering/analysis timing to the audio graph
 * and create silent failure points when a tap is removed. Tapping instead
 * of hubbing means any number of analyzers can listen to the same node
 * without affecting playback/recording at all.
 *
 * DUAL OUTPUT:
 * - getBands()   -> 64 log-spaced bands, 0-255 scale, for visual display
 *                   (SoundScope spectrum UI).
 * - getRawFFT()  -> full-resolution linear FFT bin data, unbinned, for
 *                   ScoreForge's melody-extraction pipeline (hum/sing/
 *                   whistle -> pitch detection). ScoreForge consumes THIS
 *                   output rather than running its own separate FFT.
 *
 * This is a from-scratch (Option 4) implementation. No external libraries.
 */

export class SpectrumAnalyzer64 {
  /**
   * @param {AudioContext} audioContext
   * @param {Object} [options]
   * @param {number} [options.fftSize=8192] - Must be power of 2. Larger =
   *        better low-frequency resolution, more CPU. 8192 gives good
   *        resolution down into low guitar/bass range at typical sample
   *        rates while staying cheap enough for real-time use.
   * @param {number} [options.minFreq=20]   - Bottom of the 64-band range (Hz)
   * @param {number} [options.maxFreq=20000]- Top of the 64-band range (Hz)
   * @param {number} [options.smoothingTimeConstant=0.6] - Native AnalyserNode
   *        smoothing (0 = no smoothing/instant, 1 = maximum smoothing)
   */
  constructor(audioContext, options = {}) {
    if (!audioContext) throw new Error('SpectrumAnalyzer64 requires an AudioContext');

    this.audioContext = audioContext;
    this.fftSize = options.fftSize || 8192;
    this.minFreq = options.minFreq || 20;
    this.maxFreq = options.maxFreq || Math.min(20000, audioContext.sampleRate / 2);
    this.bandCount = 64;

    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = this.fftSize;
    this._analyser.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.6;
    this._analyser.minDecibels = options.minDecibels ?? -100;
    this._analyser.maxDecibels = options.maxDecibels ?? -10;

    // Reusable buffers (avoid per-frame allocation)
    this._binCount = this._analyser.frequencyBinCount; // fftSize / 2
    this._rawByteData = new Uint8Array(this._binCount);
    this._rawFloatData = new Float32Array(this._binCount);
    this._bandData = new Float32Array(this.bandCount);

    // Precompute log-spaced band edges (bin index ranges) once.
    this._bandEdges = this._computeLogBandEdges();

    // Track connected sources so detach() is safe/idempotent.
    this._connectedSources = new Set();
  }

  /**
   * Compute 64 logarithmically-spaced frequency band edges, mapped to FFT
   * bin indices. Log spacing matches how pitch/music is perceived, so
   * bands are musically meaningful rather than linearly wasting resolution
   * on the upper octaves.
   */
  _computeLogBandEdges() {
    const sampleRate = this.audioContext.sampleRate;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / this._binCount;

    const logMin = Math.log2(this.minFreq);
    const logMax = Math.log2(this.maxFreq);
    const step = (logMax - logMin) / this.bandCount;

    const edges = [];
    for (let i = 0; i <= this.bandCount; i++) {
      const freq = Math.pow(2, logMin + step * i);
      const binIndex = Math.min(this._binCount - 1, Math.round(freq / binHz));
      edges.push(binIndex);
    }
    return edges; // length 65 (band i spans edges[i] .. edges[i+1])
  }

  /**
   * Connect an audio source (or any AudioNode) as a tap into this analyzer.
   * Does NOT alter the source's existing routing.
   * @param {AudioNode} sourceNode
   */
  attachSource(sourceNode) {
    if (!sourceNode) throw new Error('attachSource requires a valid AudioNode');
    sourceNode.connect(this._analyser);
    this._connectedSources.add(sourceNode);
    return this;
  }

  /**
   * Disconnect a previously attached source from this analyzer only.
   * Safe to call even if never attached.
   */
  detachSource(sourceNode) {
    if (!sourceNode) return this;
    try {
      sourceNode.disconnect(this._analyser);
    } catch (e) {
      // Already disconnected - not an error condition here.
    }
    this._connectedSources.delete(sourceNode);
    return this;
  }

  detachAll() {
    for (const src of this._connectedSources) {
      this.detachSource(src);
    }
    return this;
  }

  /**
   * Pull current 64-band magnitude data, 0-255 scale (matches native
   * getByteFrequencyData scale for easy UI drawing).
   * @returns {Float32Array} length 64
   */
  getBands() {
    this._analyser.getByteFrequencyData(this._rawByteData);

    for (let band = 0; band < this.bandCount; band++) {
      const startBin = this._bandEdges[band];
      const endBin = Math.max(startBin + 1, this._bandEdges[band + 1]);

      let sum = 0;
      let count = 0;
      for (let bin = startBin; bin < endBin; bin++) {
        sum += this._rawByteData[bin];
        count++;
      }
      this._bandData[band] = count > 0 ? sum / count : 0;
    }

    return this._bandData;
  }

  /**
   * Pull full-resolution raw FFT magnitude data (dB scale, float), UNBINNED.
   * This is what ScoreForge's melody-extraction pipeline consumes directly
   * rather than re-running its own FFT analysis.
   * @returns {Float32Array} length = fftSize/2
   */
  getRawFFT() {
    this._analyser.getFloatFrequencyData(this._rawFloatData);
    return this._rawFloatData;
  }

  /**
   * Convenience: returns the frequency (Hz) at the center of a given bin
   * index, for callers of getRawFFT() that need to map bins back to pitch.
   */
  binToFrequency(binIndex) {
    const nyquist = this.audioContext.sampleRate / 2;
    return (binIndex / this._binCount) * nyquist;
  }

  /**
   * Convenience: returns the center frequency of a given band (0-63),
   * useful for labeling the spectrum display.
   */
  bandCenterFrequency(bandIndex) {
    const startBin = this._bandEdges[bandIndex];
    const endBin = this._bandEdges[bandIndex + 1];
    const midBin = (startBin + endBin) / 2;
    return this.binToFrequency(midBin);
  }

  get fftBinCount() {
    return this._binCount;
  }

  /** Underlying native AnalyserNode, exposed for advanced/edge-case use. */
  get nativeNode() {
    return this._analyser;
  }
}
