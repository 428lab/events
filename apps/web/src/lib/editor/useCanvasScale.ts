import { useLayoutEffect, useRef, useState } from "react";

/**
 * 編集キャンバスの表示倍率。
 *
 * 中身は原寸（DECK_W × DECK_H）で置いて、外枠の実測幅に合わせて transform で
 * 縮める。要素の座標を実寸で持てるので、投影側と同じ数字のまま扱える。
 */
export function useCanvasScale(designWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, width, scale: width > 0 ? width / designWidth : 0 };
}
