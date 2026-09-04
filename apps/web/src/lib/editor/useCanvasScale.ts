import { useLayoutEffect, useRef, useState } from "react";

/**
 * 編集キャンバスの表示倍率。
 *
 * 中身は原寸（DECK_W × DECK_H）で置いて、外枠の実測幅に合わせて transform で
 * 縮める。要素の座標を実寸で持てるので、投影側と同じ数字のまま扱える。
 *
 * **測る対象の要素が生えてから測る必要がある。** 返した ref を付けた要素が、
 * 読み込み中の早期 return より後ろにしか描かれない画面（配信セット編集がそう）では、
 * 最初の1回で `ref.current` が null になり、倍率が 0 のままになる。0 のままだと
 * 呼ぶ側の `scale > 0` の判定で**何も描かれない真っ白なキャンバス**になり、
 * エラーも出ないので気づけない。その場合は `ready` に「要素が描かれたか」を渡す。
 * スライド編集では要素が常にあるので既定の true でよい。
 */
export function useCanvasScale(designWidth: number, ready = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ready]);

  return { ref, width, scale: width > 0 ? width / designWidth : 0 };
}
