//
// Automatically send "/free" request when refreshing, switching to another page, or closing the window.
// This idea is from https://github.com/comfyanonymous/ComfyUI/issues/3192#issuecomment-2102772705. Thanks @pixelass!
//
import { app } from "/scripts/app.js";

const nodeName = "ComfyUI-Login";

app.registerExtension({
  name: nodeName,
  async init(app) {
    window.addEventListener('beforeunload', () => {
      navigator.sendBeacon("/free", JSON.stringify({ unload_models: true, free_memory: true }));
    });
  },
});
