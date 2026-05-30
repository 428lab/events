import confetti from "canvas-confetti";
import drumrollUrl from "../assets/drumroll.mp3";
import fanfareUrl from "../assets/fanfare.mp3";

/** 紙吹雪 */
export function fireConfetti(): void {
  const end = Date.now() + 1200;
  const colors = ["#5865F2", "#EB459E", "#FEE75C", "#57F287"];
  (function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors });
}

const drumroll = new Audio(drumrollUrl);
const fanfare = new Audio(fanfareUrl);
drumroll.preload = "auto";
fanfare.preload = "auto";

/** ドラムロール音声を再生し、durationMs 後にファンファーレ音声を再生する。 */
export function playDrumrollThenFanfare(durationMs = 1500): void {
  try {
    drumroll.currentTime = 0;
    void drumroll.play();
  } catch {
    /* 自動再生がブロックされた場合は無視 */
  }
  window.setTimeout(() => {
    try {
      drumroll.pause();
      fanfare.currentTime = 0;
      void fanfare.play();
    } catch {
      /* ignore */
    }
  }, durationMs);
}
