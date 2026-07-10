/**
 * VUMeter
 * -------
 * Lightweight RMS + peak level meter, used per-channel and per-bus in
 * Mixer24. This is deliberately separate from SpectrumAnalyzer64 - a VU
 * meter needs fast, simple level readout (for the meter ballistics you
 * watch while mixing), not 64-band musical analysis. Keeping them separate
 * means the mixer's meters stay cheap even with 24 channels + 2 buses all
 * metering simultaneously.
 *
 * Also uses the tap pattern - never a routing hub.
 */

export class VUMeter {
  /**
   * @param {AudioContext} audioContext
   * @param {Object} [options]
   * @param {number} [options.fftSize=1024] - small, just need time-domain
   *        samples for RMS, not frequency resolution.
   * @param {number} [options.peakHoldMs=1500] - how long the peak indicator
   *        holds before decaying.
   */
  constructor(audioContext, options = {}) {
    this.audioContext = audioContext;
    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = options.fftSize || 1024;
    this._analyser.smoothingTimeConstant = 0; // raw samples, we do our own ballistics

    this._timeData = new Float32Array(this._analyser.fftSize);

    this._peakHoldMs = options.peakHoldMs ?? 1500;
    this._peakValue = 0;
    this._peakTimestamp = 0;

    this._connectedSource = null;
  }

  attachSource(sourceNode) {
    if (this._connectedSource) this.detach();
    sourceNode.connect(this._analyser);
    this._connectedSource = sourceNode;
    return this;
  }

  detach() {
    if (this._connectedSource) {
      try {
        this._connectedSource.disconnect(this._analyser);
      } catch (e) {
        /* already disconnected */
      }
      this._connectedSource = null;
    }
    return this;
  }

  /**
   * Reads current level. Returns both RMS (average, ballistically representative
   * of perceived loudness) and peak (highest instantaneous sample, with hold).
   * @returns {{rms: number, rmsDb: number, peak: number, peakDb: number, clipping: boolean}}
   */
  read() {
    this._analyser.getFloatTimeDomainData(this._timeData);

    let sumSquares = 0;
    let instantPeak = 0;
    for (let i = 0; i < this._timeData.length; i++) {
      const sample = this._timeData[i];
      sumSquares += sample * sample;
      const abs = Math.abs(sample);
      if (abs > instantPeak) instantPeak = abs;
    }
    const rms = Math.sqrt(sumSquares / this._timeData.length);

    const now = this.audioContext.currentTime * 1000;
    if (instantPeak >= this._peakValue || now - this._peakTimestamp > this._peakHoldMs) {
      this._peakValue = instantPeak;
      this._peakTimestamp = now;
    }

    return {
      rms,
      rmsDb: this._toDb(rms),
      peak: this._peakValue,
      peakDb: this._toDb(this._peakValue),
      clipping: instantPeak >= 0.999,
    };
  }

  _toDb(linear) {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
  }

  get nativeNode() {
    return this._analyser;
  }
}
