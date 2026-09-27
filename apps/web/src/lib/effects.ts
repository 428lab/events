import confetti from "canvas-confetti";
import { AWARDS_DRUMROLL_MS } from "@eventer/shared";
import drumrollUrl from "../assets/drumroll.mp3";
import fanfareUrl from "../assets/fanfare.mp3";

/** 紙吹雪 */
export function fireConfetti(): void {
  const end = Date.now() + 1200;
  const colors = ["#2DD4BF", "#FB923C", "#FB7185", "#FBBF24", "#FFFFFF"];
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

/** 発表のDB書込からの経過位置で再生。音の許可と結果表示のタイマーは分ける。 */
export function playDrumroll(onReveal: () => void, elapsedMs = 0): () => void {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < AWARDS_DRUMROLL_MS) {
    try {
      drumroll.currentTime = elapsed / 1000;
      void drumroll.play()?.catch(() => undefined);
    } catch {
      // 音が使えなくても他の待機画面と同じ時間だけ結果を待つ。
    }
  }
  const timer = window.setTimeout(onReveal, Math.max(0, AWARDS_DRUMROLL_MS - elapsed));
  return () => {
    window.clearTimeout(timer);
    drumroll.pause();
    fanfare.pause();
  };
}

/** ファンファーレを再生 */
export function playFanfare(): void {
  try {
    fanfare.currentTime = 0;
    void fanfare.play()?.catch(() => undefined);
  } catch {
    /* ignore */
  }
}
