/**
 * spectrumAnalyzer.js
 * -------------------
 * Draws the 64-band master spectrum analyzer. Reads from
 * window.nightstarEngine.masterAnalyser, which is a TAP (see
 * nightstarAudioEngine.js) — this file only ever reads from it,
 * never connects anything to/through it.
 */

(function () {
  let canvas, ctx;
  let rawBuffer; // raw linear FFT bins from the analyser
  let animationFrameId = null;

  const OUTPUT_BANDS = 64;

  function init() {
    canvas = document.getElementById("spectrum-canvas");
    if (!canvas) {
      console.warn("spectrum-canvas not found in DOM");
      return;
    }
    ctx = canvas.getContext("2d");
  }

  function start() {
    const engine = window.nightstarEngine;
    if (!engine || !engine.masterAnalyser) {
      console.warn("Engine not initialized yet — call nightstarEngine.init() first");
      return;
    }

    rawBuffer = new Uint8Array(engine.masterAnalyser.frequencyBinCount);
    draw();
  }

  function stop() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function draw() {
    const engine = window.nightstarEngine;
    animationFrameId = requestAnimationFrame(draw);

    engine.masterAnalyser.getByteFrequencyData(rawBuffer);

    const logBands = NightstarAudioEngine.toLogBands(
      rawBuffer,
      OUTPUT_BANDS,
      engine.context.sampleRate,
      engine.masterAnalyser.fftSize
    );

    renderBands(logBands);
  }

  function renderBands(bands) {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / bands.length;
    const gap = 2;

    for (let i = 0; i < bands.length; i++) {
      const value = bands[i]; // 0-255
      const barHeight = (value / 255) * height;

      const x = i * barWidth;
      const y = height - barHeight;

      // Simple level-based color: green -> yellow -> red, matches
      // conventional VU/spectrum coloring so it reads at a glance.
      const level = value / 255;
      const hue = 120 - level * 120; // 120 = green, 0 = red
      ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

      ctx.fillRect(x, y, barWidth - gap, barHeight);
    }
  }

  window.spectrumAnalyzer = { init, start, stop };
})();
