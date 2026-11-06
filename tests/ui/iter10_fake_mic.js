// Fake getUserMedia: window.__fakeMode = "speech" (decoded window.__mp3b64) or "noise" (low-amplitude noise)
(() => {
  window.__fakeMode = window.__fakeMode || "speech";
  const orig = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.audio) return orig.call(navigator.mediaDevices, c);
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    if (window.__fakeMode === "speech" && window.__mp3b64) {
      const bin = Uint8Array.from(atob(window.__mp3b64), (ch) => ch.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bin.buffer);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start();
    } else {
      const len = ctx.sampleRate * 5;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.003;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(dest);
      src.start();
    }
    return dest.stream;
  };
})();
