/**
 * NightstarAudioEngine
 * --------------------
 * Top-level abstraction layer for Phase 1.4. Owns the AudioContext, the
 * Mixer24, and the SpectrumAnalyzer64, and wires them together "over/under":
 * the analyzer taps the mixer's output bus by default (or any single
 * channel, when you want to analyze one source in isolation - e.g. a
 * vocalist humming a melody for ScoreForge).
 *
 * MODE TOGGLE:
 *   'production' - normal mixing/monitoring. Analyzer runs at a lighter
 *                  update rate (visual spectrum display only).
 *   'analysis'   - melody/chord extraction priority (ScoreForge). Analyzer
 *                  taps a single selected channel (not the summed bus,
 *                  since summed audio is useless for pitch detection) and
 *                  exposes getRawFFT() at full rate for the extraction
 *                  pipeline.
 *
 * Also houses the smaller Phase 1.4 utilities: input device selection,
 * silence padding, and universal load/save of mixer state.
 */

import { Mixer24 } from './mixer.js';
import { SpectrumAnalyzer64 } from './spectrum-analyzer.js';

const MODES = ['production', 'analysis'];
const SAVE_FORMAT_VERSION = 1;

export class NightstarAudioEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.channelCount=24]
   * @param {number} [options.sampleRate] - optional, defers to browser default if omitted
   */
  constructor(options = {}) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)(
      options.sampleRate ? { sampleRate: options.sampleRate } : undefined
    );

    this.mixer = new Mixer24(this.audioContext, options.channelCount || 24);
    this.analyzer = new SpectrumAnalyzer64(this.audioContext);

    this.mode = 'production';

    // Default over/under wiring: analyzer taps the mixer's output bus.
    this._analyzerTapTarget = 'outputBus';
    this.analyzer.attachSource(this.mixer.outputBus);

    this._availableInputDevices = [];
  }

  /**
   * Switch between production and analysis mode. Re-routes the analyzer's
   * tap accordingly.
   * @param {'production'|'analysis'} mode
   * @param {number} [analysisChannelId] - required when switching to
   *        'analysis' mode: which channel to isolate for extraction.
   */
  setMode(mode, analysisChannelId = null) {
    if (!MODES.includes(mode)) {
      throw new Error(`Invalid mode "${mode}". Must be one of ${MODES.join(', ')}`);
    }

    if (mode === 'analysis') {
      if (analysisChannelId == null) {
        throw new Error('setMode("analysis", channelId) requires a channel id to isolate');
      }
      const channel = this.mixer.getChannel(analysisChannelId);
      if (!channel) {
        throw new Error(`No channel with id ${analysisChannelId}`);
      }
      this._retapAnalyzer(channel.panner, `channel:${analysisChannelId}`);
      this.analyzer._analyser.smoothingTimeConstant = 0.2; // more responsive for pitch tracking
    } else {
      this._retapAnalyzer(this.mixer.outputBus, 'outputBus');
      this.analyzer._analyser.smoothingTimeConstant = 0.6; // smoother for visual display
    }

    this.mode = mode;
    return this;
  }

  _retapAnalyzer(newSourceNode, tag) {
    // Detach from whatever it's currently tapping, then tap the new source.
    this.analyzer.detachAll();
    this.analyzer.attachSource(newSourceNode);
    this._analyzerTapTarget = tag;
  }

  // ---------- Device selection ----------

  /**
   * Enumerate available audio input devices. Requires prior mic permission
   * grant (browser will only return labeled devices after getUserMedia has
   * been called at least once).
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async listInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this._availableInputDevices = devices.filter((d) => d.kind === 'audioinput');
    return this._availableInputDevices;
  }

  /**
   * Open a specific input device and connect it to a mixer channel.
   * @param {string} deviceId
   * @param {number} channelId - existing mixer channel id to route into
   * @returns {Promise<MediaStreamAudioSourceNode>}
   */
  async connectInputDevice(deviceId, channelId) {
    const channel = this.mixer.getChannel(channelId);
    if (!channel) throw new Error(`No channel with id ${channelId}`);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
    });
    const sourceNode = this.audioContext.createMediaStreamSource(stream);
    channel.connectSource(sourceNode);
    return sourceNode;
  }

  // ---------- Silence padding ----------

  /**
   * Return a new AudioBuffer with `seconds` of silence added at the start
   * and/or end of the given buffer. Used to give melody-input pipeline /
   * exports clean lead-in and lead-out.
   * @param {AudioBuffer} buffer
   * @param {Object} [opts]
   * @param {number} [opts.leadIn=0]  seconds of silence to add before
   * @param {number} [opts.leadOut=0] seconds of silence to add after
   * @returns {AudioBuffer}
   */
  padWithSilence(buffer, { leadIn = 0, leadOut = 0 } = {}) {
    const sampleRate = buffer.sampleRate;
    const leadInSamples = Math.round(leadIn * sampleRate);
    const leadOutSamples = Math.round(leadOut * sampleRate);
    const newLength = leadInSamples + buffer.length + leadOutSamples;

    const newBuffer = this.audioContext.createBuffer(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const srcData = buffer.getChannelData(ch);
      const destData = newBuffer.getChannelData(ch);
      destData.set(srcData, leadInSamples); // zeros elsewhere by default
    }

    return newBuffer;
  }

  // ---------- Universal load/save ----------

  /**
   * Serialize current mixer state (channel trims, faders, pans, mutes,
   * types, master gain, mode) to a plain object suitable for JSON storage.
   */
  saveState() {
    const channels = [...this.mixer.channels.values()].map((ch) => ({
      id: ch.id,
      type: ch.type,
      trim: ch.inputGain.gain.value,
      fader: ch._preMuteFaderValue,
      pan: ch.panner.pan.value,
      muted: ch.muted,
    }));

    return {
      formatVersion: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      mode: this.mode,
      masterGain: this.mixer.masterGain.gain.value,
      channels,
    };
  }

  /**
   * Restore mixer state from an object produced by saveState(). Rebuilds
   * channels if the mixer is empty; otherwise applies values to existing
   * channels by id, creating any that are missing.
   */
  loadState(state) {
    if (!state || state.formatVersion !== SAVE_FORMAT_VERSION) {
      throw new Error('Unrecognized or incompatible save format');
    }

    this.mixer.setMasterGain(state.masterGain);

    for (const chState of state.channels) {
      let channel = this.mixer.getChannel(chState.id);
      if (!channel) {
        channel = this.mixer.addChannel(chState.type);
      }
      channel.setTrim(chState.trim);
      channel.setFader(chState.fader);
      channel.setPan(chState.pan);
      if (chState.muted) channel.mute();
      else channel.unmute();
    }

    if (state.mode === 'production') {
      this.setMode('production');
    }
    // Note: 'analysis' mode is intentionally NOT auto-restored since it
    // requires an explicit channel selection - caller should call
    // setMode('analysis', channelId) after loadState() if needed.

    return this;
  }

  /** Convenience: save state as a JSON string. */
  saveStateJSON() {
    return JSON.stringify(this.saveState(), null, 2);
  }

  /** Convenience: load state from a JSON string. */
  loadStateJSON(json) {
    return this.loadState(JSON.parse(json));
  }
}
