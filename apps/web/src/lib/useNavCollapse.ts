import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * ヘッダーの横並びナビが幅に収まらなくなったら畳む、という判定フック (#316)。
 *
 * 固定ブレークポイントでの切り替えだと、権限バッジの有無やログイン状態で
 * ナビの必要幅が変わるため「収まらないのに横並びのまま」= 右側が見切れて
 * 到達できない項目が出る幅が必ず残る。そこで実測して判断する。
 *
 * 呼び出し側の前提:
 * - containerRef … ナビが使える幅（余白）を持つ、`overflow: hidden` な箱
 * - contentRef   … ナビ本体。`flexShrink: 0` で縮まないようにしておく
 * - 畳んでいる間も contentRef の要素は DOM に残し、`visibility: hidden` で隠す
 *   （`display: none` にすると幅が測れなくなり、二度と展開できなくなる）
 *
 * 畳むとハンバーガーの分だけ container が狭くなるので、
 * 「展開に必要な幅」>「畳む閾値」となりヒステリシスが自然に効く。
 * そのため境界幅でのちらつき（畳む↔展開の往復）は起きない。
 */
export function useNavCollapse<
  C extends HTMLElement,
  N extends HTMLElement,
>() {
  const containerRef = useRef<C | null>(null);
  const contentRef = useRef<N | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const available = container.clientWidth;
    const needed = content.scrollWidth;
    // レイアウトを持たない環境（テストの jsdom など）では 0 になる。
    // 判定できないので従来どおり横並びのままにしておく
    if (!needed) {
      setCollapsed(false);
      return;
    }
    setCollapsed(needed > available);
  }, []);

  // 初回描画で一瞬はみ出して見えないよう、ペイント前に測る
  useLayoutEffect(measure);

  useEffect(() => {
    // ResizeObserver 未対応環境でも、せめてウィンドウリサイズには追従する
    window.addEventListener("resize", measure);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    if (ro) {
      if (containerRef.current) ro.observe(containerRef.current);
      if (contentRef.current) ro.observe(contentRef.current);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return { containerRef, contentRef, collapsed };
}
