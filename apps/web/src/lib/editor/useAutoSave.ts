import { useEffect, useRef } from "react";

/** 変更が落ち着くまで待つ時間 */
const SAVE_DELAY_MS = 800;

/**
 * 編集画面の自動保存。変更の delayMs 後に1回だけ保存する。
 *
 * 読み込みが済むまで（ready が false の間）は数えない。済んだ直後の1回も投げない
 * ＝サーバーから受け取った中身をそのまま書き戻さない。
 * スライド編集とライブ配信セット編集で同じものを使う。
 */
export function useAutoSave({
  ready,
  deps,
  onSave,
  delayMs = SAVE_DELAY_MS,
}: {
  /** 読み込みが済んだか */
  ready: boolean;
  /** これが変わったら保存する（編集中の中身・タイトルなど） */
  deps: readonly unknown[];
  onSave: () => void;
  delayMs?: number;
}): void {
  // 保存の中身は毎レンダで変わるので、待っている間も最新のものを使う
  const save = useRef(onSave);
  save.current = onSave;
  const loaded = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    const t = setTimeout(() => save.current(), delayMs);
    return () => clearTimeout(t);
    // deps の中身が再実行の条件。呼び出し側で長さが変わらないこと
  }, [ready, delayMs, ...deps]);
}
