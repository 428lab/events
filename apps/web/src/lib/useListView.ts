import { useCallback, useEffect, useState } from "react";

/**
 * イベント一覧の見せ方 (#488)。
 * - list:    従来の表示。狭い画面では画像が全幅で上に載る。**既定**
 * - compact: 左サムネ＋右情報を幅を問わず横並びにして、1画面に多く入れる
 * - grid:    縦型タイルを 2〜3 列に並べる
 *
 * 密度を上げる表示は**選んだ人だけ**に出す。画像に日時や会場を書き込んでいる
 * イベントは小さいサムネで読めなくなるので、一律に置き換えない（レビュー指摘）。
 */
export const LIST_VIEWS = ["list", "compact", "grid"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

const STORAGE_KEY = "eventer:listView";
/** 旧キー（1列=1 / 2列=2）。"2" を選んでいた人はグリッドのまま引き継ぐ */
const LEGACY_KEY = "eventer:listColumns";
/** 同一ページ内の複数インスタンス（トップの各セクション等）を同期させるためのイベント名 */
const CHANGE_EVENT = "eventer:listView-change";

const isListView = (v: unknown): v is ListView =>
  (LIST_VIEWS as readonly unknown[]).includes(v);

export function readListView(): ListView {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isListView(v)) return v;
    return localStorage.getItem(LEGACY_KEY) === "2" ? "grid" : "list";
  } catch {
    return "list";
  }
}

/**
 * 見せ方を localStorage と同期する共通フック。
 * 全一覧ページ・同一ページ内の複数セクションで選択を共有する。
 */
export function useListView(): [ListView, (v: ListView) => void] {
  const [view, setViewState] = useState<ListView>(readListView);

  useEffect(() => {
    // 値はイベントの detail で受け取る（localStorage 書込失敗環境でも同期できるように）
    const sync = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      setViewState(isListView(detail) ? detail : readListView());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    // 別タブでの変更にも追従
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setView = useCallback((v: ListView) => {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // localStorage 不可の環境ではセッション内のみ反映
    }
    setViewState(v);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: v }));
  }, []);

  return [view, setView];
}
