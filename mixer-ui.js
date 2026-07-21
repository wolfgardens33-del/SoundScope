/**
 * mixer-ui.js
 * -----------
 * Renders channel strips for Mixer24 into the #mixer-channels container,
 * and keeps their VU meters updating in real time. Pure DOM, no framework,
 * consistent with the from-scratch (Option 4) policy.
 *
 * Each strip: type badge, trim slider, vertical fader, pan slider, mute
 * button, and two VU meter bars (pre-fader input level, post-fader channel
 * level) per the "VU meters on every input and output" spec requirement.
 */

const CHANNEL_TYPES = ['line', 'usb', 'mic'];

// Plain-language labels for beginners vs. real audio-engineering terms.
// Simple mode is the default - Nightstar's whole point is not locking
// people out with vocabulary before they're ready for it.
const LABELS = {
  simple:   { trim: 'Boost',  fader: 'Volume', pan: 'Left / Right', in: 'In',  out: 'Out' },
  advanced: { trim: 'Trim',   fader: 'Fader',  pan: 'Pan',          in: 'IN',  out: 'OUT' },
};

export class MixerUI {
  /**
   * @param {NightstarAudioEngine} engine
   * @param {HTMLElement} channelsContainer - #mixer-channels
   * @param {HTMLElement} addChannelContainer - where the "add channel" control goes
   * @param {HTMLElement} [labelModeContainer] - where the Simple/Advanced toggle goes.
   *        Falls back to addChannelContainer if not provided.
   */
  constructor(engine, channelsContainer, addChannelContainer, labelModeContainer) {
    this.engine = engine;
    this.channelsContainer = channelsContainer;
    this.addChannelContainer = addChannelContainer;
    this.labelModeContainer = labelModeContainer || addChannelContainer;
    this._stripEls = new Map(); // channelId -> { root, meters: {...}, labelEls: {...} }
    this._meterLoopHandle = null;
    this.labelMode = 'simple'; // default: beginner-friendly

    this._buildLabelModeToggle();
    this._buildAddChannelControl();
    this._renderExistingChannels();
    this._startMeterLoop();
  }

  _buildLabelModeToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'label-mode-toggle';

    const simpleBtn = document.createElement('button');
    simpleBtn.textContent = 'Simple';
    simpleBtn.className = 'label-mode-btn active';

    const advancedBtn = document.createElement('button');
    advancedBtn.textContent = 'Advanced';
    advancedBtn.className = 'label-mode-btn';

    simpleBtn.addEventListener('click', () => {
      this.labelMode = 'simple';
      simpleBtn.classList.add('active');
      advancedBtn.classList.remove('active');
      this._applyLabelMode();
    });
    advancedBtn.addEventListener('click', () => {
      this.labelMode = 'advanced';
      advancedBtn.classList.add('active');
      simpleBtn.classList.remove('active');
      this._applyLabelMode();
    });

    wrap.append(simpleBtn, advancedBtn);
    this.labelModeContainer.appendChild(wrap);
  }

  _applyLabelMode() {
    const labels = LABELS[this.labelMode];
    for (const strip of this._stripEls.values()) {
      strip.labelEls.trim.textContent = labels.trim;
      strip.labelEls.fader.textContent = labels.fader;
      strip.labelEls.pan.textContent = labels.pan;
      strip.labelEls.inMeter.textContent = labels.in;
      strip.labelEls.outMeter.textContent = labels.out;
    }
  }

  _buildAddChannelControl() {
    this.addChannelContainer.innerHTML = '';

    const select = document.createElement('select');
    select.id = 'add-channel-type';
    for (const type of CHANNEL_TYPES) {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = type.toUpperCase();
      select.appendChild(opt);
    }

    const btn = document.createElement('button');
    btn.textContent = '+ Add Channel';
    btn.addEventListener('click', () => {
      const { mixer } = this.engine;
      if (mixer.channels.size >= mixer.channelCount) {
        alert(`Mixer is full (${mixer.channelCount} channels max)`);
        return;
      }
      const channel = mixer.addChannel(select.value);
      this._renderChannelStrip(channel);
    });

    const countLabel = document.createElement('span');
    countLabel.id = 'channel-count-label';
    this._countLabel = countLabel;
    this._updateCountLabel();

    this.addChannelContainer.appendChild(select);
    this.addChannelContainer.appendChild(btn);
    this.addChannelContainer.appendChild(countLabel);
  }

  _updateCountLabel() {
    const { size } = this.engine.mixer.channels;
    const max = this.engine.mixer.channelCount;
    this._countLabel.textContent = ` ${size} / ${max} channels`;
  }

  _renderExistingChannels() {
    for (const channel of this.engine.mixer.channels.values()) {
      this._renderChannelStrip(channel);
    }
  }

  _renderChannelStrip(channel) {
    const labels = LABELS[this.labelMode];

    const root = document.createElement('div');
    root.className = 'channel-strip';
    root.dataset.channelId = String(channel.id);

    // --- Header: id + type badge + remove button ---
    const header = document.createElement('div');
    header.className = 'strip-header';
    const idLabel = document.createElement('span');
    idLabel.className = 'strip-id';
    idLabel.textContent = `#${channel.id}`;
    const typeBadge = document.createElement('span');
    typeBadge.className = `strip-type strip-type-${channel.type}`;
    typeBadge.textContent = channel.type.toUpperCase();
    const removeBtn = document.createElement('button');
    removeBtn.className = 'strip-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove channel';
    removeBtn.addEventListener('click', () => {
      this.engine.mixer.removeChannel(channel.id);
      root.remove();
      this._stripEls.delete(channel.id);
      this._updateCountLabel();
    });
    header.append(idLabel, typeBadge, removeBtn);

    // --- VU meters (input = pre-fader, channel = post-fader) ---
    const meterRow = document.createElement('div');
    meterRow.className = 'strip-meters';
    const inputMeterBar = this._buildMeterBar(labels.in);
    const channelMeterBar = this._buildMeterBar(labels.out);
    meterRow.append(inputMeterBar.root, channelMeterBar.root);

    // --- Trim ---
    const trimRow = this._buildSliderRow(labels.trim, 0, 2, 0.01, channel.inputGain.gain.value, (v) =>
      channel.setTrim(v)
    );

    // --- Fader (vertical) ---
    const faderRow = document.createElement('div');
    faderRow.className = 'strip-fader-row';
    const faderLabel = document.createElement('label');
    faderLabel.textContent = labels.fader;
    const faderInput = document.createElement('input');
    faderInput.type = 'range';
    faderInput.className = 'fader-vertical';
    faderInput.min = '0';
    faderInput.max = '1.5';
    faderInput.step = '0.01';
    faderInput.value = String(channel.fader.gain.value);
    faderInput.addEventListener('input', () => channel.setFader(parseFloat(faderInput.value)));
    faderRow.append(faderLabel, faderInput);

    // --- Pan ---
    const panRow = this._buildSliderRow(labels.pan, -1, 1, 0.01, channel.panner.pan.value, (v) =>
      channel.setPan(v)
    );

    // --- Mute ---
    const muteBtn = document.createElement('button');
    muteBtn.className = 'strip-mute';
    muteBtn.textContent = 'Mute';
    muteBtn.addEventListener('click', () => {
      if (channel.muted) {
        channel.unmute();
        muteBtn.classList.remove('active');
      } else {
        channel.mute();
        muteBtn.classList.add('active');
      }
    });

    root.append(header, meterRow, trimRow, faderRow, panRow, muteBtn);
    this.channelsContainer.appendChild(root);

    this._stripEls.set(channel.id, {
      root,
      inputMeterFill: inputMeterBar.fill,
      channelMeterFill: channelMeterBar.fill,
      labelEls: {
        trim: trimRow.querySelector('label'),
        fader: faderLabel,
        pan: panRow.querySelector('label'),
        inMeter: inputMeterBar.labelEl,
        outMeter: channelMeterBar.labelEl,
      },
    });

    this._updateCountLabel();
  }

  _buildMeterBar(label) {
    const root = document.createElement('div');
    root.className = 'vu-meter';
    const labelEl = document.createElement('span');
    labelEl.className = 'vu-meter-label';
    labelEl.textContent = label;
    const track = document.createElement('div');
    track.className = 'vu-meter-track';
    const fill = document.createElement('div');
    fill.className = 'vu-meter-fill';
    track.appendChild(fill);
    root.append(labelEl, track);
    return { root, fill, labelEl };
  }

  _buildSliderRow(labelText, min, max, step, value, onChange) {
    const row = document.createElement('div');
    row.className = 'strip-slider-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onChange(parseFloat(input.value)));
    row.append(label, input);
    return row;
  }

  /**
   * Convert a linear 0-1 RMS/peak value to a 0-100% meter fill height,
   * using a simple dB-based scale so the meter feels responsive across
   * the useful range rather than only reacting near full scale.
   */
  _levelToPercent(linear) {
    if (linear <= 0) return 0;
    const db = 20 * Math.log10(linear);
    // Map -60dB..0dB onto 0%..100%
    const percent = ((db + 60) / 60) * 100;
    return Math.max(0, Math.min(100, percent));
  }

  _startMeterLoop() {
    const update = () => {
      for (const [id, channel] of this.engine.mixer.channels) {
        const strip = this._stripEls.get(id);
        if (!strip) continue;
        const meters = channel.readMeters();
        strip.inputMeterFill.style.height = `${this._levelToPercent(meters.input.rms)}%`;
        strip.channelMeterFill.style.height = `${this._levelToPercent(meters.channel.rms)}%`;
        strip.inputMeterFill.classList.toggle('clipping', meters.input.clipping);
        strip.channelMeterFill.classList.toggle('clipping', meters.channel.clipping);
      }
      this._meterLoopHandle = requestAnimationFrame(update);
    };
    update();
  }

  stop() {
    if (this._meterLoopHandle) cancelAnimationFrame(this._meterLoopHandle);
  }
}
