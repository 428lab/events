import confetti from "canvas-confetti";

/** 紙吹雪 */
export function fireConfetti(): void {
  const end = Date.now() + 1200;
  const colors = ["#5865F2", "#EB459E", "#FEE75C", "#57F287"];
  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors });
}

let audioCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!audioCtx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new C();
  }
  return audioCtx;
}

/** ドラムロール（ノイズ連打）→ ファンファーレ。durationMs 後にファンファーレ。 */
export function playDrumrollThenFanfare(durationMs = 1500): void {
  const ac = ctx();
  if (ac.state === "suspended") void ac.resume();
  const now = ac.currentTime;

  // ドラムロール: 短いノイズバーストを連打
  const hits = Math.floor(durationMs / 60);
  for (let i = 0; i < hits; i++) {
    const t = now + (i * 60) / 1000;
    const buffer = ac.createBuffer(1, 512, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * 0.5;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    src.connect(g).connect(ac.destination);
    src.start(t);
  }

  // ファンファーレ: 和音アルペジオ
  const fStart = now + durationMs / 1000;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const t = fStart + i * 0.12;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}
