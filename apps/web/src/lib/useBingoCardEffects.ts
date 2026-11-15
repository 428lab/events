import { useEffect, useRef, useState } from "react";
import type { BingoState } from "@eventer/shared";
import { vibrate } from "./vibrate.js";

/**
 * 参加者のビンゴカードの演出 (#681 PR2)。投影 (useBingoScreenEffects) と同じく、**同じゲームの
 * 連続する BingoState の差分**だけで起こす。初回の表示・再読み込み・ゲームが替わったとき
 * （gameId が違う）・取り消し（true → false）では何も起こさない。
 *
 * - リーチになった瞬間: 画面全体を `BINGO_REACH_FLASH_MS` 光らせて「リーチ！」（自動で消える）＋短い振動
 * - ビンゴになった瞬間: 全画面の層を開く（手で閉じるまで残す。司会・スタッフに見せるため）＋長い振動
 * - 新しくマークされたセル: `BINGO_MARK_PULSE_MS` だけ弾ませる（スマホではロールしない）
 * - reduced: 光らせない・弾ませない。ビンゴの層は動きなしで出す。振動は画面の動きではないので振る
 *
 * 時間差は setTimeout で作る（setInterval は使わない。noPolling.test.ts）。
 */
export const BINGO_REACH_FLASH_MS = 1_500;
export const BINGO_MARK_PULSE_MS = 500;
export const BINGO_REACH_VIBRATION = 100;
export const BINGO_BINGO_VIBRATION = [200, 100, 200, 100, 400];

export interface BingoCardEffects {
  /** リーチの全画面フラッシュ中（通し番号。null は出さない） */
  reachFlash: number | null;
  /** ビンゴの全画面の層を出しているか */
  bingoOpen: boolean;
  closeBingo: () => void;
  /** いま新しくマークされた自分のカードの番号（弾ませる） */
  pulseNumbers: number[];
}

interface Seen {
  gameId: number | null;
  reach: boolean;
  bingo: boolean;
  drawn: number;
}

export function useBingoCardEffects(data: BingoState | undefined, reduced: boolean): BingoCardEffects {
  const [reachFlash, setReachFlash] = useState<number | null>(null);
  const [bingoOpen, setBingoOpen] = useState(false);
  const [pulseNumbers, setPulseNumbers] = useState<number[]>([]);
  const seen = useRef<Seen | null>(null);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = (fn: () => void, ms: number) => {
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      fn();
    }, ms);
    timers.current.add(handle);
  };

  const ready = data !== undefined && data.status !== "none";
  const gameId = data?.gameId ?? null;
  const reach = Boolean(data?.me?.reach);
  const bingo = Boolean(data?.me?.bingo);
  const drawn = data?.drawnNumbers ?? [];
  const drawnCount = drawn.length;

  useEffect(() => {
    if (!ready) return;
    const before = seen.current;
    seen.current = { gameId, reach, bingo, drawn: drawnCount };
    // 初回の表示・ゲームが替わったときは何も起こさない（開き直しで鳴らさない）
    if (!before || before.gameId !== gameId || gameId === null) {
      setBingoOpen(false);
      return;
    }

    if (bingo && !before.bingo) {
      setBingoOpen(true);
      vibrate(BINGO_BINGO_VIBRATION);
    } else if (!bingo && before.bingo) {
      // 抽選の取り消しでビンゴでなくなった: 層を閉じる（演出はしない）
      setBingoOpen(false);
    } else if (reach && !before.reach && !bingo) {
      vibrate(BINGO_REACH_VIBRATION);
      if (!reduced) {
        seq.current += 1;
        const key = seq.current;
        setReachFlash(key);
        later(() => setReachFlash((k) => (k === key ? null : k)), BINGO_REACH_FLASH_MS);
      }
    }

    if (drawnCount > before.drawn && !reduced && data?.card) {
      const mine = new Set(data.card);
      const added = drawn.slice(before.drawn).filter((n) => mine.has(n));
      if (added.length > 0) {
        setPulseNumbers(added);
        later(() => setPulseNumbers((p) => (p === added ? [] : p)), BINGO_MARK_PULSE_MS);
      }
    }
    // 差分だけを見る。later は毎回作り直されるが、中身は ref と setState だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gameId, reach, bingo, drawnCount, reduced]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return { reachFlash, bingoOpen, closeBingo: () => setBingoOpen(false), pulseNumbers };
}
