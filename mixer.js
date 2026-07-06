/**
 * mixer.js
 * --------
 * Builds the 24-channel mixer strip UI and drives the VU meters for
 * every channel's input and output taps. Each channel's audio routing
 * (source -> fader -> master) is created by nightstarEngine.createChannel();
 * this file is purely UI + meter-reading, it does not create audio nodes
 * itself beyond what the engine already sets up.
 */

(function () {
  const CHANNEL_COUNT = 24;
  let meterBuffers = []; // one Uint8Array per channel, reused per frame
  let animationFrameId = null;

  function buildChannelStripDOM(id) {
    const strip = document.createElement("div");
    strip.className = "mixer-channel";
    strip.dataset.channelId = id;

    strip.innerHTML = `
      <div class="channel-label">CH ${id + 1}</div>
      <div class="vu-meter vu-input"><div class="vu-fill"></div></div>
      <input type="range" class="fader" min="0" max="1.5" step="0.01" value="0.8" />
      <div class="vu-meter vu-output"><div class="vu-fill"></div></div>
      <button class="mute-btn">Mute</button>
    `;

    return strip;
  }

  /**
   * Call this once per channel after the engine has created it via
   * nightstarEngine.createChannel(id, sourceNode). Wires the UI fader
   * to the actual GainNode and sets up meter reading for that channel.
   */
  function attachChannel(channel) {
    const container = document.getElementById("mixer-channels");
    const strip = buildChannelStripDOM(channel.id);
    container.appendChild(strip);

    const faderInput = strip.querySelector(".fader");
    faderInput.addEventListener("input", (e) => {
      channel.fader.gain.value = parseFloat(e.target.value);
    });

    const muteBtn = strip.querySelector(".mute-btn");
    muteBtn.addEventListener("click", () => {
      channel.muted = !channel.muted;
      channel.fader.gain.value = channel.muted ? 0 : parseFloat(faderInput.value);
      muteBtn.classList.toggle("active", channel.muted);
    });

    meterBuffers[channel.id] = {
      input: new Uint8Array(channel.inputAnalyser.frequencyBinCount),
      output: new Uint8Array(channel.outputAnalyser.frequencyBinCount),
      inputEl: strip.querySelector(".vu-input .vu-fill"),
      outputEl: strip.querySelector(".vu-output .vu-fill"),
      channel,
    };
  }

  function rmsLevel(byteData) {
    // Convert byte time/frequency data into a rough 0-1 RMS-style level
    // for VU display purposes (not a calibrated dBFS reading).
    let sumSquares = 0;
    for (let i = 0; i < byteData.length; i++) {
      const normalized = byteData[i] / 255;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / byteData.length);
  }

  function updateMeters() {
    animationFrameId = requestAnimationFrame(updateMeters);

    meterBuffers.forEach((entry) => {
      if (!entry) return;

      entry.channel.inputAnalyser.getByteFrequencyData(entry.input);
      entry.channel.outputAnalyser.getByteFrequencyData(entry.output);

      const inputLevel = rmsLevel(entry.input);
      const outputLevel = rmsLevel(entry.output);

      entry.inputEl.style.height = `${Math.round(inputLevel * 100)}%`;
      entry.outputEl.style.height = `${Math.round(outputLevel * 100)}%`;
    });
  }

  /**
   * Sets up all 24 channels against the engine. sourceNodes should be an
   * array of 24 AudioNodes (e.g. MediaStreamAudioSourceNode from selected
   * input devices, or placeholder oscillators/silence during initial testing).
   */
  function initChannels(sourceNodes) {
    const engine = window.nightstarEngine;
    if (!engine || !engine.initialized) {
      console.warn("Engine not initialized — call nightstarEngine.init() first");
      return;
    }

    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const source = sourceNodes[i];
      if (!source) {
        console.warn(`No source node provided for channel ${i}, skipping`);
        continue;
      }
      const channel = engine.createChannel(i, source);
      attachChannel(channel);
    }

    updateMeters();
  }

  function stop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  window.mixer = { initChannels, stop, CHANNEL_COUNT };
})();
