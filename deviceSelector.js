/**
 * deviceSelector.js
 * -----------------
 * Populates the input device dropdown using the browser's device
 * enumeration API, and requests a MediaStream from the selected device
 * when chosen. Full OS-level enumeration (not a fixed list) — flagged
 * as an open item in the spec and resolved here in favor of the dynamic
 * approach, since it's more useful for Line/USB/Mic switching without
 * hardcoding device names.
 */

(function () {
  let selectEl;
  let onDeviceSelectedCallback = null;

  async function requestPermissionAndListDevices() {
    // Must request mic permission first, or device labels come back blank
    // (browsers hide labels until permission is granted, for privacy).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the temporary stream immediately — we only needed it to unlock labels.
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.warn("Microphone permission denied or unavailable:", err);
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  function populateDropdown(devices) {
    selectEl.innerHTML = "";
    devices.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Input ${selectEl.length + 1}`;
      selectEl.appendChild(option);
    });
  }

  async function getStreamForSelectedDevice() {
    const deviceId = selectEl.value;
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  async function init(onDeviceSelected) {
    selectEl = document.getElementById("input-device-select");
    if (!selectEl) {
      console.warn("input-device-select not found in DOM");
      return;
    }
    onDeviceSelectedCallback = onDeviceSelected;

    const devices = await requestPermissionAndListDevices();
    populateDropdown(devices);

    // Re-scan if devices change (USB interface plugged/unplugged mid-session)
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      const updated = await requestPermissionAndListDevices();
      populateDropdown(updated);
    });

    selectEl.addEventListener("change", async () => {
      const stream = await getStreamForSelectedDevice();
      if (onDeviceSelectedCallback) onDeviceSelectedCallback(stream);
    });
  }

  window.deviceSelector = { init, getStreamForSelectedDevice };
})();
