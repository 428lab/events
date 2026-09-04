import { useEffect, useRef } from "react";

/**
 * 編集画面のキーボード操作。
 *
 * スライド編集とライブ配信セット編集が同じ判定を別々に持っていたので1か所にまとめた。
 * 「何を選んでいるか」は画面ごとに形が違う（単数/複数）ので、
 * ここは押されたキーを命令に翻訳するだけにして、実際の編集は呼び出し側に任せる。
 */
export interface EditorKeyCommands {
  undo: () => void;
  redo: () => void;
  /** 何か選ばれているか。false なら削除・複製・矢印移動は効かせない */
  hasSelection: boolean;
  remove: () => void;
  duplicate: () => void;
  /** 矢印での移動。Shift 押下なら 10、それ以外は 1 が渡る */
  nudge: (dx: number, dy: number) => void;
  /** まとめる操作。持たない画面は渡さない */
  group?: () => void;
  /** group を効かせてよいか（2つ以上選んでいるか） */
  canGroup?: boolean;
}

/**
 * 文字を打っている最中はショートカットを効かせない。
 * テキスト要素の編集中に Backspace で要素ごと消える、といった事故を防ぐ。
 */
function isTyping(): boolean {
  const tag = (document.activeElement?.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea";
}

/** 押されたキーを命令に振り分ける。テスト用に切り出してある */
export function handleEditorKey(c: EditorKeyCommands, e: KeyboardEvent): void {
  const typing = isTyping();
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if ((k === "z" || k === "y") && !typing) {
      e.preventDefault();
      if (k === "y" || (k === "z" && e.shiftKey)) c.redo();
      else c.undo();
    } else if (k === "d" && c.hasSelection && !typing) {
      e.preventDefault();
      c.duplicate();
    } else if (k === "g" && c.canGroup && c.group && !typing) {
      e.preventDefault();
      c.group();
    }
    // 修飾キー付きの他の組み合わせ（コピー・保存など）はブラウザに任せる
    return;
  }
  if (typing || !c.hasSelection) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    c.remove();
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    c.nudge(-step, 0);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    c.nudge(step, 0);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    c.nudge(0, -step);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    c.nudge(0, step);
  }
}

export function useEditorKeyboard(commands: EditorKeyCommands): void {
  // 登録は1回だけにして、中身は毎レンダの最新に差し替える
  // （選択や履歴を閉じ込めた古い関数を呼ばないように）
  const latest = useRef(commands);
  latest.current = commands;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleEditorKey(latest.current, e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
