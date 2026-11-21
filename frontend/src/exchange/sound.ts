export async function openFloorSound() {
  const context = new AudioContext();
  try {
    await context.resume();
  } catch (error) {
    void context.close();
    throw error;
  }
  const bed = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
  const data = bed.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    brown = (brown + .026 * (Math.random() * 2 - 1)) / 1.026;
    data[i] = brown * Math.min(1, i / 1800, (data.length - i) / 1800);
  }
  const ambient = context.createBufferSource();
  ambient.buffer = bed;
  ambient.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 410;
  filter.Q.value = .37;
  const gain = context.createGain();
  gain.gain.value = .16;
  const pan = context.createStereoPanner();
  ambient.connect(filter).connect(gain).connect(pan).connect(context.destination);
  ambient.start();
  let closed = false;
  let lastStep = 0, lastX = NaN, lastZ = NaN;

  function tone(frequency: number, level: number, duration: number, type: OscillatorType) {
    if (closed || context.state !== "running") return;
    const signal = context.createOscillator(), volume = context.createGain();
    const now = context.currentTime;
    signal.type = type;
    signal.frequency.setValueAtTime(frequency, now);
    signal.frequency.exponentialRampToValueAtTime(frequency * .72, now + duration);
    volume.gain.setValueAtTime(.001, now);
    volume.gain.linearRampToValueAtTime(level, now + .011);
    volume.gain.exponentialRampToValueAtTime(.001, now + duration);
    signal.connect(volume).connect(pan);
    signal.start();
    signal.stop(now + duration + .015);
    signal.onended = () => { signal.disconnect(); volume.disconnect(); };
  }

  const onVisibility = () => {
    if (context.state === "closed") return;
    const task = document.hidden ? context.suspend() : context.resume();
    void task.catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  return {
    position(x: number, z: number, yaw: number) {
      if (closed || context.state !== "running") return;
      pan.pan.setTargetAtTime(Math.sin(yaw) * -.32 + x / 48, context.currentTime, .12);
      gain.gain.setTargetAtTime(.105 + .065 * Math.max(0, 1 - Math.abs(z) / 12), context.currentTime, .22);
      const movement = Math.hypot(x - lastX, z - lastZ);
      if (movement > .11 && movement < 1.1 && context.currentTime - lastStep > .30) {
        lastStep = context.currentTime;
        tone(134 + Math.random() * 24, .043, .094, "triangle");
      }
      lastX = x; lastZ = z;
    },
    select() { tone(580, .033, .15, "sine"); },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      ambient.stop();
      void context.close().catch(() => {});
    },
  };
}
