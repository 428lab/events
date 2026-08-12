/**
 * 翻訳キーの置き場 (#352)。
 *
 * **画面・サーバー・メールで同じものを見る**ので shared に置いてある
 * （後の段階で通知とメールもここを引く）。i18next などのライブラリには
 * 依存させない。ここが持つのはただの入れ子オブジェクト。
 *
 * 追加するときは `messages/` に**領域ごとのファイル**を作り、その中に
 * 日本語と英語を並べて書く。片方だけ足すと型で落ちる。
 */
import { common } from "./messages/common.js";
import { errors } from "./messages/errors.js";
import { eventDetail } from "./messages/eventDetail.js";
import { events } from "./messages/events.js";
import { labels } from "./messages/labels.js";
import { login } from "./messages/login.js";
import { nav } from "./messages/nav.js";
import { settings } from "./messages/settings.js";
import type { AppLanguage } from "./languages.js";

export * from "./languages.js";

/** 言語ごとの辞書。i18next には `resources` としてこのまま渡せる形 */
export const translations = {
  ja: {
    common: common.ja,
    nav: nav.ja,
    login: login.ja,
    events: events.ja,
    eventDetail: eventDetail.ja,
    errors: errors.ja,
    settings: settings.ja,
    ...labels.ja,
  },
  en: {
    common: common.en,
    nav: nav.en,
    login: login.en,
    events: events.en,
    eventDetail: eventDetail.en,
    errors: errors.en,
    settings: settings.en,
    ...labels.en,
  },
} satisfies Record<AppLanguage, Record<string, Record<string, string>>>;

/** 日本語の辞書がキーの source。英語に無いキーは日本語に落ちる */
export type TranslationResource = (typeof translations)["ja"];
