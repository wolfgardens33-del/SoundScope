/**
 * main.js
 * -------
 * Wires the whole SoundScope v1.4 shell together. AudioContext creation
 * must happen from a user gesture, so nothing audio-related fires until
 * the user interacts with the page (per browser autoplay policy).
 *
 * Analysis vs Production mode: behavior difference was an open item in
 * the spec. Implemented here with a reasonable default — Analysis mode
 * shows the 64-band analyzer prominently and hides the EQ (since you're
 * listening/comparing, not shaping); Production mode hides the analyzer
 * panel to save CPU and surfaces the EQ for active mixing. Change the
 * toggleMode() logic below if that's not the right split.
 */

(function () {
  let engineStarted = false;

  function setStatus(text) {
    const statusEl = document.getElementById("engine-status");
    if (statusEl) statusEl.textContent = text;
  }

  async function startEngine() {
    if (engineStarted) return;

    window.nightstarEngine.init();
    setStatus("NightstarAudioEngine: running");

    spectrumAnalyzer.init();
    spectrumAnalyzer.start();

    await deviceSelector.init((stream) => {
      // Selected input device changed — wrap it as a source node and
      // feed it into channel 0 as an example. Real wiring of all 24
      // channels to real hardware inputs depends on how many physical
      // inputs are actually available; placeholder oscillators fill
      // the rest during UI testing.
      const source = window.nightstarEngine.context.createMediaStreamSource(stream);
      if (window.nightstarEngine.channels[0]) {
        source.connect(window.nightstarEngine.channels[0].fader);
      }
    });

    // Placeholder source nodes for the 24-channel mixer until real
    // hardware inputs are wired per-channel. Silent gain nodes so the
    // mixer UI and meters are testable without live audio.
    const placeholderSources = [];
    for (let i = 0; i < mixer.CHANNEL_COUNT; i++) {
      const silentGain = window.nightstarEngine.context.createGain();
      silentGain.gain.value = 0;
      placeholderSources.push(silentGain);
    }
    mixer.initChannels(placeholderSources);

    // EQ inserted between master gain and destination as an example
    // insertion point — adjust if EQ should sit per-channel instead of
    // on the master bus.
    eq.init(window.nightstarEngine.masterGain, window.nightstarEngine.context.destination);

    engineStarted = true;
  }

  function toggleMode(mode) {
    const analysisBtn = document.getElementById("mode-analysis");
    const productionBtn = document.getElementById("mode-production");
    const analyzerPanel = document.getElementById("spectrum-analyzer-panel");
    const eqPanel = document.getElementById("eq-panel");

    if (mode === "analysis") {
      analysisBtn.classList.add("active");
      productionBtn.classList.remove("active");
      analyzerPanel.style.display = "block";
      eqPanel.style.display = "none";
    } else {
      analysisBtn.classList.remove("active");
      productionBtn.classList.add("active");
      analyzerPanel.style.display = "none";
      eqPanel.style.display = "block";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("mode-analysis").addEventListener("click", () => toggleMode("analysis"));
    document.getElementById("mode-production").addEventListener("click", () => toggleMode("production"));

    // Engine starts on first user interaction anywhere in the app,
    // satisfying the browser's autoplay-gesture requirement without
    // forcing a dedicated "Start" button if you don't want one.
    document.body.addEventListener(
      "click",
      () => {
        startEngine();
      },
      { once: true }
    );
  });
})();
