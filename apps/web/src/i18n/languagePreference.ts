/**
 * 利用者が選んだ表示言語を、この端末に覚えておく (#354)。
 *
 * **保存先を知っているのはこのファイルだけ**。言語の判定 (`i18n/index.ts`) は
 * 保存領域を知らないままにしてある。判定の途中で保存領域に触れると、
 * プライベートモードなど保存が禁じられた環境で起動時に例外が飛び、
 * 画面が真っ白になるため（`i18n.test.tsx` がその退行を見張っている）。
 *
 * 読み書きはどちらも try/catch。保存できない環境でも、そのセッションの
 * 表示だけは切り替わる。
 *
 * アカウントに紐づけて端末をまたいで揃えるのは #352 の第3段階の話で、
 * ここではやらない。
 */
import { normalizeLanguage, type AppLanguage } from "@eventer/shared/i18n";

/** 設定画面で選べる値。`auto` は「ブラウザの言語に合わせる」＝保存しない */
export type LanguageChoice = "auto" | AppLanguage;

/** 端末に残す場所。ほかの端末設定 (`eventer:listColumns` など) と同じ流儀 */
const STORAGE_KEY = "eventer:language";

/** 選択を、言語判定に渡す形（「指定なし」は null）に直す */
export function asPreference(choice: LanguageChoice): AppLanguage | null {
  return choice === "auto" ? null : choice;
}

/** いまの選択。保存が読めない・対応外の値が入っていたときは「自動」 */
export function readLanguageChoice(): LanguageChoice {
  try {
    return normalizeLanguage(localStorage.getItem(STORAGE_KEY)) ?? "auto";
  } catch {
    return "auto";
  }
}

/** 選択を保存する。「自動」なら保存値を消してブラウザの言語判定に戻す */
export function writeLanguageChoice(choice: LanguageChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // 保存できない環境では、このセッションの表示だけ切り替える
  }
}

/** 保存されている「利用者の設定」。`detectLanguage` の第3引数に渡す値 */
export function storedLanguage(): AppLanguage | null {
  return asPreference(readLanguageChoice());
}
