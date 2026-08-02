import { useCallback, useEffect, useState } from "react";

/** イベント一覧の表示列数（1列=横型カード / 2列=縦型タイル）。 */
export type ListColumns = 1 | 2;

const STORAGE_KEY = "eventer:listColumns";
/** 同一ページ内の複数インスタンス（トップの各セクション等）を同期させるためのイベント名 */
const CHANGE_EVENT = "eventer:listColumns-change";

function readColumns(): ListColumns {
  try {
    return localStorage.getItem(STORAGE_KEY) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}

/**
 * イベント一覧の表示列数を localStorage と同期する共通フック。
 * 全一覧ページ・同一ページ内の複数セクションで選択を共有する。既定は1列。
 */
export function useListColumns(): [ListColumns, (c: ListColumns) => void] {
  const [columns, setColumnsState] = useState<ListColumns>(readColumns);

  useEffect(() => {
    // 値はイベントの detail で受け取る（localStorage 書込失敗環境でも同期できるように）
    const sync = (e: Event) => {
      const detail = (e as CustomEvent<ListColumns>).detail;
      setColumnsState(detail === 2 ? 2 : detail === 1 ? 1 : readColumns());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    // 別タブでの変更にも追従
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setColumns = useCallback((c: ListColumns) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(c));
    } catch {
      // localStorage 不可の環境ではセッション内のみ反映
    }
    setColumnsState(c);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: c }));
  }, []);

  return [columns, setColumns];
}
