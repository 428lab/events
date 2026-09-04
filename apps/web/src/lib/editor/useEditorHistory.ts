import { useEffect, useRef, useState } from "react";

/**
 * 編集画面の Undo/Redo。
 *
 * スライド編集とライブ配信セット編集が同じ仕掛けを別々に持っていたので、
 * 編集対象の型を問わない形で1か所にまとめた。積むのは「変更前の丸ごとの中身」で、
 * 差分は取らない。中身は毎回作り直される（不変オブジェクト）ので、
 * 同一性の比較だけで「変わったか」が分かる。
 */

/** 連続した変更をまとめる猶予。この間に続いた変更は1ステップとして積む */
const COMMIT_DELAY_MS = 500;
/** 積んでおく上限。古いものから捨てる */
const MAX_DEPTH = 100;

export interface EditorHistory<T> {
  /**
   * 読み込み直後の中身を基準として置く。ここより前には戻れない。
   * 積んであるものは捨てる。
   */
  reset: (initial: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory<T>({
  content,
  setContent,
  onRestore,
}: {
  /** 編集中の中身。読み込み前は null */
  content: T | null;
  /** 戻した/進めた中身を反映する */
  setContent: (next: T) => void;
  /** 戻した/進めたあとに呼ぶ。選択を外すのに使う */
  onRestore?: () => void;
}): EditorHistory<T> {
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  /** 最後に履歴へ積んだ状態。ここと content が違えば「未確定の変更あり」 */
  const lastCommitted = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 積んだ本数は ref なので、ボタンの活性を描き直すために版数を持つ
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    if (content === null || lastCommitted.current === null) return;
    if (content === lastCommitted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      undoStack.current.push(lastCommitted.current!);
      if (undoStack.current.length > MAX_DEPTH) undoStack.current.shift();
      lastCommitted.current = content;
      redoStack.current = [];
      bumpVersion((v) => v + 1);
    }, COMMIT_DELAY_MS);
  }, [content]);

  /** 猶予待ちの分を即座に積む。戻る/進むの前に呼ぶ */
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (lastCommitted.current !== null && content !== lastCommitted.current) {
      undoStack.current.push(lastCommitted.current);
      lastCommitted.current = content;
      redoStack.current = [];
    }
  };

  const undo = () => {
    flush();
    const prev = undoStack.current.pop();
    if (prev === undefined || lastCommitted.current === null) return;
    redoStack.current.push(lastCommitted.current);
    lastCommitted.current = prev;
    setContent(prev);
    onRestore?.();
    bumpVersion((v) => v + 1);
  };

  const redo = () => {
    flush();
    const next = redoStack.current.pop();
    if (next === undefined || lastCommitted.current === null) return;
    undoStack.current.push(lastCommitted.current);
    lastCommitted.current = next;
    setContent(next);
    onRestore?.();
    bumpVersion((v) => v + 1);
  };

  const reset = (initial: T) => {
    undoStack.current = [];
    redoStack.current = [];
    lastCommitted.current = initial;
  };

  return {
    reset,
    undo,
    redo,
    // 猶予待ちの変更もまだ積んでいないだけで「戻せる」ので数に入れる
    canUndo:
      undoStack.current.length > 0 ||
      (lastCommitted.current !== null && content !== lastCommitted.current),
    canRedo: redoStack.current.length > 0,
  };
}
