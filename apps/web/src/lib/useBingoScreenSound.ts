import { useEffect, useRef, useState } from "react";
import { playBingoLand, playBingoRoll, playFanfare, stopBingoRoll, unlockBingoSound } from "./effects.js";
import type { BingoScreenEffects } from "./useBingoScreenEffects.js";

/**
 * ビンゴの投影の音 (#681 PR4)。オンのときだけ、演出に合わせて鳴らす:
 * ロールが始まったらドラム、番号が止まったら短い音、ビンゴのカットインでファンファーレ。
 * いつ鳴らすかは `useBingoScreenEffects` の出力（rolling・landKey・cutin）の変わり目だけで決める
 * （差分を二重に持たない）。reduced motion ではロールしないので、止まる音とファンファーレだけ鳴る。
 *
 * 自動再生がブロックされたら `blocked` を立て、次に画面のどこかをクリックしたときに1回だけ
 * 許可を取り直して消す。参加者のスマホ（EventBingoPage）では使わない（会場で一斉に鳴らさない）。
 */
export function useBingoScreenSound(
  fx: Pick<BingoScreenEffects, "rolling" | "landKey" | "cutin">,
  enabled: boolean,
): { blocked: boolean } {
  const [blocked, setBlocked] = useState(false);
  const cutinKey = fx.cutin?.key ?? 0;
  const prev = useRef({ rolling: fx.rolling, landKey: fx.landKey, cutinKey });

  useEffect(() => {
    const before = prev.current;
    prev.current = { rolling: fx.rolling, landKey: fx.landKey, cutinKey };
    if (!enabled) return;
    const report = (played: Promise<boolean>) => {
      void played.then((ok) => {
        if (!ok) setBlocked(true);
      });
    };
    if (fx.rolling && !before.rolling) report(playBingoRoll());
    if (fx.landKey > 0 && fx.landKey !== before.landKey) {
      stopBingoRoll();
      report(playBingoLand());
    }
    if (cutinKey > 0 && cutinKey !== before.cutinKey) report(playFanfare());
  }, [enabled, fx.rolling, fx.landKey, cutinKey]);

  // オフにしたとき・画面を離れたときは鳴っているドラムを止める
  useEffect(() => {
    if (!enabled) stopBingoRoll();
    return () => stopBingoRoll();
  }, [enabled]);

  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      setBlocked(false);
      void unlockBingoSound();
    };
    window.addEventListener("click", retry, { once: true });
    return () => window.removeEventListener("click", retry);
  }, [blocked]);

  return { blocked: enabled && blocked };
}
