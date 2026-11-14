import { useEffect, useRef, useState } from "react";
import { BINGO_MAX_NUMBER, type BingoState } from "@eventer/shared";

/**
 * ビンゴ投影の演出 (#681 PR1)。どれも**連続する BingoState の差分**だけで起こす（値がどの経路で
 * 届いたかには依存しない）。初回の表示・取り直しで
 * 値が変わらないとき・取り消し（番号が減る）では何も起こさない。
 *
 * - 番号のロール: 番号が増えたら、大きな数字を `BINGO_ROLL_MS` のあいだ乱数で回してから本当の番号で
 *   止める。ロール中に次の番号が来たら、待たずにすぐ最新の番号で止める（司会が速くても置いて行かれない）
 * - リーチ・ビンゴ人数: 増えたら「+n」を `BINGO_BADGE_MS` 出す。リーチが増えたら煽りの一言を
 *   `BINGO_SURGE_MS` 出す（`BINGO_SURGE_BIG` 人以上で文言を変える）
 * - reduced: ロールしない。番号はすぐ差し替え、明るさを1回だけ変える（`flash`）
 *
 * 時間差は setTimeout の連鎖で作る（setInterval は使わない。noPolling.test.ts）。
 */
export const BINGO_ROLL_MS = 1_500;
/** ロール中に数字を差し替える間隔 */
export const BINGO_ROLL_TICK_MS = 70;
export const BINGO_BADGE_MS = 2_000;
export const BINGO_SURGE_MS = 3_000;
/** リーチの増分がこれ以上なら「一気に増えた」の文言にする */
export const BINGO_SURGE_BIG = 5;

export interface BingoCountBadge {
  n: number;
  /** 同じ増分が続いても演出をかけ直すための通し番号 */
  key: number;
}

export interface BingoScreenEffects {
  /** 大きく出す番号（ロール中は乱数）。まだ引いていなければ null */
  shownNumber: number | null;
  rolling: boolean;
  /** 止まった瞬間の拡大・明度変化をかけ直すための通し番号（0 は演出なし） */
  landKey: number;
  /** 履歴グリッドで光らせる、いま引かれた番号 */
  pulseNumber: number | null;
  reachBadge: BingoCountBadge | null;
  bingoBadge: BingoCountBadge | null;
  surge: { n: number; big: boolean; key: number } | null;
}

interface Seen {
  drawn: number;
  reach: number;
  bingo: number;
}

const randomNumber = () => 1 + Math.floor(Math.random() * BINGO_MAX_NUMBER);

export function useBingoScreenEffects(data: BingoState | undefined, reduced: boolean): BingoScreenEffects {
  const drawn = data?.drawnNumbers ?? [];
  const latest = drawn.length > 0 ? drawn[drawn.length - 1] : null;

  const [rollNumber, setRollNumber] = useState<number | null>(null);
  const [landKey, setLandKey] = useState(0);
  const [pulseNumber, setPulseNumber] = useState<number | null>(null);
  const [reachBadge, setReachBadge] = useState<BingoCountBadge | null>(null);
  const [bingoBadge, setBingoBadge] = useState<BingoCountBadge | null>(null);
  const [surge, setSurge] = useState<BingoScreenEffects["surge"]>(null);

  const seen = useRef<Seen | null>(null);
  const seq = useRef(0);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = (fn: () => void, ms: number) => {
    const handle = setTimeout(() => {
      timers.current.delete(handle);
      fn();
    }, ms);
    timers.current.add(handle);
  };
  const stopRoll = () => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = null;
    setRollNumber(null);
  };
  const land = (n: number) => {
    stopRoll();
    seq.current += 1;
    setLandKey(seq.current);
    setPulseNumber(n);
  };

  const reach = data?.counts.reach ?? 0;
  const bingo = data?.counts.bingo ?? 0;
  const ready = data !== undefined;
  const drawnCount = drawn.length;

  useEffect(() => {
    if (!ready) return;
    const before = seen.current;
    seen.current = { drawn: drawnCount, reach, bingo };
    // 初回の表示では何も起こさない（開き直し・再読み込みで鳴らさない）
    if (!before) return;

    if (drawnCount > before.drawn && latest !== null) {
      if (reduced || rollTimer.current) {
        // reduced はロールしない。ロール中に次が来たら、すぐ最新で止める
        land(latest);
      } else {
        const endAt = Date.now() + BINGO_ROLL_MS;
        const tick = () => {
          if (Date.now() >= endAt) {
            land(latest);
            return;
          }
          setRollNumber(randomNumber());
          rollTimer.current = setTimeout(tick, BINGO_ROLL_TICK_MS);
        };
        tick();
      }
    } else if (drawnCount < before.drawn) {
      // 取り消し: 演出なしで差し替える
      stopRoll();
      setPulseNumber(null);
    }

    if (reach > before.reach) {
      const n = reach - before.reach;
      seq.current += 1;
      const key = seq.current;
      setReachBadge({ n, key });
      setSurge({ n, big: n >= BINGO_SURGE_BIG, key });
      later(() => setReachBadge((b) => (b?.key === key ? null : b)), BINGO_BADGE_MS);
      later(() => setSurge((s) => (s?.key === key ? null : s)), BINGO_SURGE_MS);
    }
    if (bingo > before.bingo) {
      seq.current += 1;
      const key = seq.current;
      setBingoBadge({ n: bingo - before.bingo, key });
      later(() => setBingoBadge((b) => (b?.key === key ? null : b)), BINGO_BADGE_MS);
    }
    // 差分だけを見る。land / later は毎回作り直されるが、中身は ref と setState だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawnCount, latest, reach, bingo, reduced]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return {
    shownNumber: rollNumber ?? latest,
    rolling: rollNumber !== null,
    landKey,
    pulseNumber,
    reachBadge,
    bingoBadge,
    surge,
  };
}
