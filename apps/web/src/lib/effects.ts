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

/**
 * ドラムロールを最後まで再生し、再生完了時に onEnd を呼ぶ。
 * 自動再生がブロックされた場合や想定より長い場合は安全タイマーで onEnd する。
 */
export function playDrumroll(onEnd: () => void): void {
  let done = false;
  let timer = 0;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    onEnd();
  };

  drumroll.onended = finish;
  drumroll.currentTime = 0;

  // ended が発火しない/極端に長い場合の安全タイマー
  const safetyMs =
    (Number.isFinite(drumroll.duration) && drumroll.duration > 0
      ? drumroll.duration * 1000
      : 6000) + 1500;
  timer = window.setTimeout(finish, safetyMs);

  const p = drumroll.play();
  if (p) p.catch(() => finish());
}

/** ファンファーレを再生 */
export function playFanfare(): void {
  try {
    fanfare.currentTime = 0;
    void fanfare.play();
  } catch {
    /* ignore */
  }
}
