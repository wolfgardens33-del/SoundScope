/**
 * eq.js
 * -----
 * 32-band graphic EQ UI. Confirmed as a SEPARATE component from the
 * spectrum analyzer — this actively shapes the signal (inline BiquadFilter
 * chain via nightstarEngine.createGraphicEQ), it does not just visualize it.
 */

(function () {
  let eqInstance = null; // { bands, input, output } from the engine

  function buildBandSliderDOM(band, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "eq-band";

    const freqLabel = document.createElement("label");
    const freq = band.frequency.value;
    freqLabel.textContent = freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${Math.round(freq)}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "-15";
    slider.max = "15";
    slider.step = "0.5";
    slider.value = "0";
    slider.orient = "vertical"; // Firefox supports this attribute directly
    slider.className = "eq-slider";

    slider.addEventListener("input", (e) => {
      band.gain.value = parseFloat(e.target.value);
    });

    wrapper.appendChild(slider);
    wrapper.appendChild(freqLabel);
    return wrapper;
  }

  /**
   * Inserts the 32-band EQ between sourceNode and destinationNode using
   * the engine's factory, then builds the slider UI.
   */
  function init(sourceNode, destinationNode) {
    const engine = window.nightstarEngine;
    if (!engine || !engine.initialized) {
      console.warn("Engine not initialized — call nightstarEngine.init() first");
      return;
    }

    eqInstance = engine.createGraphicEQ(sourceNode, destinationNode);

    const container = document.getElementById("eq-bands");
    container.innerHTML = "";
    eqInstance.bands.forEach((band, i) => {
      container.appendChild(buildBandSliderDOM(band, i));
    });
  }

  function reset() {
    if (!eqInstance) return;
    eqInstance.bands.forEach((band) => {
      band.gain.value = 0;
    });
    document.querySelectorAll(".eq-slider").forEach((slider) => {
      slider.value = "0";
    });
  }

  window.eq = { init, reset };
})();
