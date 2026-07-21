/**
 * Mixer24
 * -------
 * 24-channel mixer: Line / USB / Mic inputs, bus capture of BOTH inputs
 * and outputs, VU meters on every input and every output.
 *
 * SIGNAL FLOW per channel:
 *   source -> inputGain (trim) -> [VU tap: pre-fader input meter]
 *          -> fader -> panner -> [VU tap: post-fader channel meter]
 *          -> inputBus (sum, pre-master, this is what gets captured
 *             as the "input bus" recording)
 *
 *   inputBus -> masterGain -> outputBus -> [VU tap: master/output meter]
 *            -> destination (speakers) AND -> outputBusCapture (recording)
 *
 * From-scratch (Option 4): built entirely on native Web Audio nodes.
 */

import { VUMeter } from './vu-meter.js';

const CHANNEL_TYPES = ['line', 'usb', 'mic'];

class MixerChannel {
  constructor(audioContext, id, type = 'line') {
    if (!CHANNEL_TYPES.includes(type)) {
      throw new Error(`Invalid channel type "${type}". Must be one of ${CHANNEL_TYPES.join(', ')}`);
    }
    this.audioContext = audioContext;
    this.id = id;
    this.type = type;

    this.sourceNode = null; // set via connectSource()

    this.inputGain = audioContext.createGain();   // trim
    this.fader = audioContext.createGain();        // channel fader (0-1+)
    this.panner = audioContext.createStereoPanner();

    this.inputGain.gain.value = 1.0;
    this.fader.gain.value = 0.8; // sensible default, not full-hot
    this.panner.pan.value = 0;

    this.inputGain.connect(this.fader);
    this.fader.connect(this.panner);
    // panner.connect(destinationBus) happens in Mixer24.addChannel()

    this.inputMeter = new VUMeter(audioContext);   // pre-fader, post-trim
    this.channelMeter = new VUMeter(audioContext); // post-fader/pan

    this.inputGain.connect(this.inputMeter.nativeNode); // tap, not routed onward
    this.panner.connect(this.channelMeter.nativeNode);  // tap, not routed onward

    this.muted = false;
    this.solo = false;
    this._preMuteFaderValue = this.fader.gain.value;
  }

  /**
   * Connect a live audio source (MediaStreamSource, BufferSource, etc.)
   * to this channel's input.
   */
  connectSource(sourceNode) {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect(this.inputGain);
      } catch (e) { /* already disconnected */ }
    }
    sourceNode.connect(this.inputGain);
    this.sourceNode = sourceNode;
    return this;
  }

  disconnectSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect(this.inputGain);
      } catch (e) { /* already disconnected */ }
      this.sourceNode = null;
    }
    return this;
  }

  setTrim(value) {
    this.inputGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
    return this;
  }

  setFader(value) {
    if (!this.muted) {
      this.fader.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
    }
    this._preMuteFaderValue = value;
    return this;
  }

  setPan(value) {
    this.panner.pan.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
    return this;
  }

  mute() {
    this.muted = true;
    this.fader.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
    return this;
  }

  unmute() {
    this.muted = false;
    this.fader.gain.setTargetAtTime(this._preMuteFaderValue, this.audioContext.currentTime, 0.01);
    return this;
  }

  /** Read both meters in one call for convenience. */
  readMeters() {
    return {
      input: this.inputMeter.read(),
      channel: this.channelMeter.read(),
    };
  }
}

export class Mixer24 {
  /**
   * @param {AudioContext} audioContext
   * @param {number} [channelCount=24]
   */
  constructor(audioContext, channelCount = 24) {
    this.audioContext = audioContext;
    this.channelCount = channelCount;

    // Input bus: sums all channel outputs BEFORE master gain. This is what
    // gets captured for the "input bus" recording (all channels summed,
    // pre-master-fader).
    this.inputBus = audioContext.createGain();
    this.inputBus.gain.value = 1.0;

    // Master gain sits between input bus and output bus.
    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 0.8;

    // Output bus: post-master, what actually goes to speakers/capture.
    this.outputBus = audioContext.createGain();
    this.outputBus.gain.value = 1.0;

    this.inputBus.connect(this.masterGain);
    this.masterGain.connect(this.outputBus);
    this.outputBus.connect(audioContext.destination);

    // VU meters on both buses (taps, not hubs).
    this.inputBusMeter = new VUMeter(audioContext);
    this.outputBusMeter = new VUMeter(audioContext);
    this.inputBus.connect(this.inputBusMeter.nativeNode);
    this.outputBus.connect(this.outputBusMeter.nativeNode);

    // Capture nodes: MediaStreamAudioDestinationNode taps for recording
    // either bus independently of what's going to speakers.
    this.inputBusCapture = audioContext.createMediaStreamDestination();
    this.outputBusCapture = audioContext.createMediaStreamDestination();
    this.inputBus.connect(this.inputBusCapture);
    this.outputBus.connect(this.outputBusCapture);

    this.channels = new Map(); // id -> MixerChannel
    this._nextChannelId = 1;
  }

  /**
   * Add a new channel to the mixer. Throws if channelCount would be exceeded.
   * @param {'line'|'usb'|'mic'} type
   * @returns {MixerChannel}
   */
  addChannel(type = 'line') {
    if (this.channels.size >= this.channelCount) {
      throw new Error(`Mixer24 is full (${this.channelCount} channels max)`);
    }
    const id = this._nextChannelId++;
    const channel = new MixerChannel(this.audioContext, id, type);
    channel.panner.connect(this.inputBus);
    this.channels.set(id, channel);
    return channel;
  }

  removeChannel(id) {
    const channel = this.channels.get(id);
    if (!channel) return false;
    channel.disconnectSource();
    try {
      channel.panner.disconnect(this.inputBus);
    } catch (e) { /* already disconnected */ }
    this.channels.delete(id);
    return true;
  }

  getChannel(id) {
    return this.channels.get(id);
  }

  getChannelsByType(type) {
    return [...this.channels.values()].filter((ch) => ch.type === type);
  }

  setMasterGain(value) {
    this.masterGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.01);
    return this;
  }

  /**
   * Read every meter in the mixer in one call: every channel input, every
   * channel post-fader, and both buses.
   * @returns {{channels: Object, inputBus: Object, outputBus: Object}}
   */
  readAllMeters() {
    const channels = {};
    for (const [id, channel] of this.channels) {
      channels[id] = channel.readMeters();
    }
    return {
      channels,
      inputBus: this.inputBusMeter.read(),
      outputBus: this.outputBusMeter.read(),
    };
  }

  /**
   * Returns MediaStream objects suitable for handing to a MediaRecorder,
   * for capturing the input bus (pre-master) or output bus (post-master).
   */
  getInputBusStream() {
    return this.inputBusCapture.stream;
  }

  getOutputBusStream() {
    return this.outputBusCapture.stream;
  }
}
