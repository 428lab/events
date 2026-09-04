import { useLayoutEffect, useRef, useState } from "react";

/**
 * 編集キャンバスの表示倍率。
 *
 * 中身は原寸（DECK_W × DECK_H）で置いて、外枠の実測幅に合わせて transform で
 * 縮める。要素の座標を実寸で持てるので、投影側と同じ数字のまま扱える。
 *
 * **返した ref を付ける要素は、このフックを呼ぶ部品の中で必ず描かれること。**
 * 読み込み中は描かない、のように条件付きにすると最初の1回で `ref.current` が
 * null になり、倍率が 0 のままになる。0 のままだと呼ぶ側の `scale > 0` の判定で
 * **何も描かれない真っ白なキャンバス**になり、エラーも出ないので気づけない。
 * 読み込みを待つ必要がある画面は、待つ側（ページ）と測る側（キャンバスの部品）を
 * 分ける。そうすれば部品が生えた時点＝マウント時に測れる。
 * DeckCanvas と LiveCanvas がその形になっている。
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
