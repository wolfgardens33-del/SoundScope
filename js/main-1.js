/**
 * main.js
 * -------
 * Wires the index.html shell to the actual NightstarAudioEngine.
 *
 * IMPORTANT: browsers block AudioContext + getUserMedia until a real user
 * gesture (a click) happens. That's why nothing can auto-initialize on
 * page load - the "Initialize Audio Engine" button below is required.
 */

import { NightstarAudioEngine } from './audio-engine.js';

let engine = null;
let drawLoopHandle = null;
let currentAnalysisChannelId = null;

const statusEl = document.getElementById('engine-status');
const initBtn = document.getElementById('init-engine-btn');
const modeAnalysisBtn = document.getElementById('mode-analysis');
const modeProductionBtn = document.getElementById('mode-production');
const deviceSelect = document.getElementById('input-device-select');
const canvas = document.getElementById('spectrum-canvas');
const ctx = canvas.getContext('2d');

function setStatus(text) {
  statusEl.textContent = `NightstarAudioEngine: ${text}`;
}

async function initEngine() {
  if (engine) return; // already initialized

  initBtn.disabled = true;
  setStatus('initializing...');

  try {
    engine = new NightstarAudioEngine();

    // Resume in case the browser created the AudioContext in a suspended state.
    if (engine.audioContext.state === 'suspended') {
      await engine.audioContext.resume();
    }

    // Create one channel to start with, so the device dropdown + analysis
    // mode have something to route into.
    const firstChannel = engine.mixer.addChannel('mic');
    currentAnalysisChannelId = firstChannel.id;

    // index.html marks the Analysis button as active by default, so match
    // the engine's actual internal mode to that on startup.
    engine.setMode('analysis', currentAnalysisChannelId);

    await populateDeviceList();

    // Auto-connect whatever device is currently selected in the dropdown.
    // Needed because if there's only one device, the browser never fires
    // a "change" event on the <select> (nothing actually changed), so
    // onDeviceSelected() would otherwise never run.
    if (deviceSelect.value) {
      await onDeviceSelected();
    }

    setStatus(`running (${engine.mode} mode)`);
    initBtn.textContent = 'Engine Running';
    startDrawLoop();
  } catch (err) {
    console.error('Engine init failed:', err);
    setStatus(`init failed - ${err.message}`);
    initBtn.disabled = false;
  }
}

async function populateDeviceList() {
  deviceSelect.innerHTML = '';

  // Requesting a throwaway mic stream first is what makes device labels
  // available at all (browsers hide labels until permission is granted).
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    const opt = document.createElement('option');
    opt.textContent = 'Microphone permission denied';
    deviceSelect.appendChild(opt);
    return;
  }

  const devices = await engine.listInputDevices();

  if (devices.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No input devices found';
    deviceSelect.appendChild(opt);
    return;
  }

  for (const device of devices) {
    const opt = document.createElement('option');
    opt.value = device.deviceId;
    opt.textContent = device.label || `Input ${deviceSelect.length + 1}`;
    deviceSelect.appendChild(opt);
  }
}

async function onDeviceSelected() {
  if (!engine || !currentAnalysisChannelId) return;
  const deviceId = deviceSelect.value;
  if (!deviceId) return;

  try {
    await engine.connectInputDevice(deviceId, currentAnalysisChannelId);
    setStatus(`running - input connected (${engine.mode} mode)`);
  } catch (err) {
    console.error('Failed to connect input device:', err);
    setStatus(`input connect failed - ${err.message}`);
  }
}

function setMode(mode) {
  if (!engine) return;

  if (mode === 'analysis') {
    engine.setMode('analysis', currentAnalysisChannelId);
    modeAnalysisBtn.classList.add('active');
    modeProductionBtn.classList.remove('active');
  } else {
    engine.setMode('production');
    modeProductionBtn.classList.add('active');
    modeAnalysisBtn.classList.remove('active');
  }

  setStatus(`running (${engine.mode} mode)`);
}

function startDrawLoop() {
  const width = canvas.width;
  const height = canvas.height;
  const barWidth = width / engine.analyzer.bandCount;

  function draw() {
    const bands = engine.analyzer.getBands(); // Float32Array(64), 0-255 scale

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < bands.length; i++) {
      const magnitude = bands[i] / 255; // normalize 0-1
      const barHeight = magnitude * height;
      const x = i * barWidth;
      const y = height - barHeight;

      ctx.fillStyle = `hsl(${200 - magnitude * 160}, 80%, 55%)`;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }

    drawLoopHandle = requestAnimationFrame(draw);
  }

  draw();
}

// ---------- Event wiring ----------

initBtn.addEventListener('click', initEngine);
modeAnalysisBtn.addEventListener('click', () => setMode('analysis'));
modeProductionBtn.addEventListener('click', () => setMode('production'));
deviceSelect.addEventListener('change', onDeviceSelected);
