/**
 * 設定ページから表示言語を切り替えるためのフック (#354)。
 *
 * 保存 (`languagePreference.ts`) と判定 (`index.ts`) をつなぐだけの薄い層。
 * 判定は起動時と同じ `detectFromEnvironment` を通すので、優先順位
 * **URLの指定 > 利用者の設定 > ブラウザの言語 > 日本語** はどちらでも同じ。
 *
 * 切り替えは再読み込みなしでその場で効く（`<html lang>` は
 * `syncDocumentLanguage` の購読が追従させる）。
 */
import { useCallback, useState } from "react";
import { detectFromEnvironment, i18next } from "./index.js";
import {
  asPreference,
  readLanguageChoice,
  writeLanguageChoice,
  type LanguageChoice,
} from "./languagePreference.js";

export function useLanguageChoice(): [
  LanguageChoice,
  (next: LanguageChoice) => void,
] {
  const [choice, setChoice] = useState<LanguageChoice>(readLanguageChoice);

  const change = useCallback((next: LanguageChoice) => {
    // 保存に失敗しても（保存が禁じられた環境）、この先の表示は切り替える
    writeLanguageChoice(next);
    setChoice(next);
    // 辞書は起動時に読み込み済みなので、ここが失敗する経路は事実上無い。
    // それでも受け取るのは、握らないと unhandled rejection になるため。
    // 失敗しても保存とボタンの状態は進める（表示だけが前の言語のまま残る）
    i18next
      .changeLanguage(detectFromEnvironment(asPreference(next)))
      .catch(() => {});
  }, []);

  return [choice, change];
}
