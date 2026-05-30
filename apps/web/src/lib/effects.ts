import confetti from "canvas-confetti";
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

/** ドラムロール音源の「じゃ～ん！」が鳴るタイミング（ms） */
const DRUMROLL_REVEAL_MS = 3000;

/**
 * ドラムロールを再生し、クライマックス（約3秒）の「じゃ～ん！」に合わせて onReveal を呼ぶ。
 * 音はそのまま最後まで鳴らし続ける（途中で止めない）。
 * 自動再生がブロックされた場合は即座に onReveal する。
 */
export function playDrumroll(onReveal: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onReveal();
  };

  drumroll.currentTime = 0;
  const p = drumroll.play();
  if (p) p.catch(() => finish());

  // 「じゃ～ん！」のタイミングで結果を出す。音は止めず最後まで再生。
  window.setTimeout(finish, DRUMROLL_REVEAL_MS);
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
