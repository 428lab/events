/** 端末を振動させる（#681）。対応していない環境（iOS Safari など）や、直前のユーザー操作が
 *  無くてブラウザに断られた場合は何もしない。「効けば効く」演出なので失敗は気にしない */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // 振動できなくても画面の演出はそのまま出す
  }
}
