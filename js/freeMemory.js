//
// Automatically send "/free" request when refreshing, switching to another page, or closing the window.
// This idea is from https://github.com/comfyanonymous/ComfyUI/issues/3192#issuecomment-2102772705. Thanks @pixelass!
// Don't want this feature? Simply delete this file.
//
import { app } from "/scripts/app.js";

app.registerExtension({
  name: "Comfy.Login.FreeMemory",
  async init(app) {
    let idleTimer;

    // Function to send the beacon
    function sendFreeMemoryRequest() {
      navigator.sendBeacon("/free", JSON.stringify({ unload_models: true, free_memory: true }));
    }

    // Reset the idle timer
    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(sendFreeMemoryRequest, 1800000); // 1800000 ms = 30 mins
    }

    // Listen for any of these events to reset the timer
    window.addEventListener('mousemove', resetIdleTimer, false);
    window.addEventListener('keydown', resetIdleTimer, false);
    window.addEventListener('scroll', resetIdleTimer, false);

    // Setup the initial timer
    resetIdleTimer();

    // Send request when the window is about to be closed
    window.addEventListener('beforeunload', sendFreeMemoryRequest);
  },
});