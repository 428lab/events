import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "eventer:presenterPanel";
/** 同一ページ内の複数インスタンス（トグルとパネル）を同期させるためのイベント名 */
const CHANGE_EVENT = "eventer:presenterPanel-change";

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * 登壇者向けサイドパネル (#215) の表示状態。
 * 発表ビューと配信コントロールを行き来しても保たれるよう localStorage に持つ。
 * 既定はオフ（画面を広く使いたい人の邪魔をしない）。
 */
export function usePresenterPanel(): [boolean, (v: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(readOpen);

  useEffect(() => {
    // 値はイベントの detail で受け取る（localStorage 書込失敗環境でも同期できるように）
    const sync = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOpenState(typeof detail === "boolean" ? detail : readOpen());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    // 別タブでの変更にも追従
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setOpen = useCallback((v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "on" : "off");
    } catch {
      // localStorage 不可の環境ではセッション内のみ反映
    }
    setOpenState(v);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: v }));
  }, []);

  return [open, setOpen];
}
