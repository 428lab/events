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

/** 頭から再生する。ブラウザが許したか（自動再生ブロックなら false）を返す */
async function tryPlay(audio: HTMLAudioElement): Promise<boolean> {
  try {
    audio.currentTime = 0;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** ファンファーレを再生（表彰式・ビンゴの投影のカットイン）。再生できたかを返す */
export function playFanfare(): Promise<boolean> {
  return tryPlay(fanfare);
}

/* ── ビンゴの投影の音 (#681 PR4)。投影の画面だけが使う（参加者のスマホでは鳴らさない） ──
 * 表彰式と同じ音源を使う（表彰式とビンゴの投影は同時に出ないので、同じ要素を共有してよい）。
 * 番号が止まる短い音だけは合う音源が無いので Web Audio で合成する。 */

let bingoAudioContext: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (bingoAudioContext) return bingoAudioContext;
  const Ctor = typeof window === "undefined" ? undefined : window.AudioContext;
  if (!Ctor) return null;
  try {
    bingoAudioContext = new Ctor();
  } catch {
    return null;
  }
  return bingoAudioContext;
}

/** 音をオンにした操作（クリック）の中で呼ぶ。自動再生の許可を取る:
 * Web Audio を再開し、音源を消音で一度再生して止める（Safari は要素ごとに許可が要る） */
export async function unlockBingoSound(): Promise<void> {
  void audioContext()?.resume().catch(() => undefined);
  await Promise.all([drumroll, fanfare].map(async (audio) => {
    audio.muted = true;
    await tryPlay(audio);
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  }));
}

/** 番号のロール中のドラム。止まったら `stopBingoRoll` で切る */
export function playBingoRoll(): Promise<boolean> {
  return tryPlay(drumroll);
}

export function stopBingoRoll(): void {
  drumroll.pause();
}

/** 番号が止まったときの短い音（合成）。Web Audio の無い環境では何もしない */
export async function playBingoLand(): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return true;
  if (ctx.state !== "running") return false;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.3);
  return true;
}
