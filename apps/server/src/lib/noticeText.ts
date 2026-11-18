import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  translations,
  type AppLanguage,
} from "@eventer/shared/i18n";

/**
 * サーバーが作る文言を、受け取る人の言語で組み立てる (#352)。オーナー決定 2026-11-19（案 A）。
 *
 * 言語は user.language（本人が最後に使った画面の言語。設定で選んだ言語があればそちら。
 * migration 0128）。分からない人は日本語。文言は `@eventer/shared/i18n` の `notices`
 * 名前空間の1か所で、画面と同じ辞書を見る。イベント名など人が入力したものは差し込むだけで訳さない。
 *
 * - JS で作るお知らせは `localized(key, params)` を渡す。宛先ごとの言語で `notificationsRepo` が組み立てる
 * - SQL の中で作るお知らせ（参加・抽選・日程などを同じ D1 batch で書くもの）は `sqlNotice` で
 *   宛先の言語の列を見る CASE 式にする
 */
export type NoticeKey = keyof (typeof translations)["ja"]["notices"];
export type NoticeParams = Record<string, string | number>;

/** 宛先の言語ごとに組み立てる文言。お知らせの題名・本文として渡す */
export type LocalizedText = (lang: AppLanguage) => string;

/** DB の値（NULL・対応外を含む）を言語に寄せる。分からなければ日本語 */
export function noticeLanguage(value: string | null | undefined): AppLanguage {
  return normalizeLanguage(value) ?? DEFAULT_LANGUAGE;
}

/** `{{name}}` を差し込む。辞書に無い差し込みは空にする（キー名を出さない） */
function interpolate(template: string, params: NoticeParams = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    params[name] === undefined ? "" : String(params[name]),
  );
}

export function noticeText(lang: AppLanguage, key: NoticeKey, params?: NoticeParams): string {
  return interpolate(translations[lang].notices[key], params);
}

export function localized(key: NoticeKey, params?: NoticeParams): LocalizedText {
  return (lang) => noticeText(lang, key, params);
}

const sqlLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 辞書の文言を SQL の式にする。差し込みは SQL の式（列や `?`）を渡し、`||` でつなぐ。
 * 差し込みに `?` を渡したときは、その言語の数だけ同じ値を bind する必要があるので、
 * 列か相関サブクエリを渡すこと */
function sqlTemplate(template: string, params: Record<string, string>): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{\{(\w+)\}\}/g)) {
    if (m.index! > last) parts.push(sqlLiteral(template.slice(last, m.index)));
    const expr = params[m[1]!];
    if (expr === undefined) throw new Error(`sqlNotice: missing param ${m[1]}`);
    parts.push(expr);
    last = m.index! + m[0].length;
  }
  if (last < template.length) parts.push(sqlLiteral(template.slice(last)));
  return parts.length === 0 ? "''" : parts.join("||");
}

/** 辞書の文言を、宛先の言語の列（`langExpr`）で選ぶ CASE 式にする。
 * 日本語は ELSE 側なので、NULL・対応外の言語は日本語になる */
export function sqlNotice(langExpr: string, key: NoticeKey, params: Record<string, string> = {}): string {
  const others = SUPPORTED_LANGUAGES.filter((l) => l !== DEFAULT_LANGUAGE);
  const whens = others
    .map((l) => `WHEN ${sqlLiteral(l)} THEN ${sqlTemplate(translations[l].notices[key], params)}`)
    .join(" ");
  return `(CASE ${langExpr} ${whens} ELSE ${sqlTemplate(translations[DEFAULT_LANGUAGE].notices[key], params)} END)`;
}

/** 題名・本文。文字列はどの言語の宛先にも同じに出す（人が入力したもの・管理者向けの日本語）。
 * 関数は宛先の言語ごとに組み立てる（`localized`） */
export type NoticeText = string | LocalizedText;

export function renderNotice(text: NoticeText, lang: AppLanguage): string {
  return typeof text === "string" ? text : text(lang);
}

/** JS で組み立てた言語ごとの文字列を、宛先の言語の列で選ぶ CASE 式にする。
 * 返す `args` を、式が現れる位置に bind する */
export function sqlLocalizedValue(langExpr: string, text: NoticeText): { sql: string; args: string[] } {
  if (typeof text === "string") return { sql: "?", args: [text] };
  const others = SUPPORTED_LANGUAGES.filter((l) => l !== DEFAULT_LANGUAGE);
  return {
    sql: `(CASE ${langExpr} ${others.map((l) => `WHEN ${sqlLiteral(l)} THEN ?`).join(" ")} ELSE ? END)`,
    args: [...others.map((l) => text(l)), text(DEFAULT_LANGUAGE)],
  };
}

/** 宛先の言語の列（user 表の相関サブクエリ）。`userExpr` は宛先の利用者 ID の式 */
export const recipientLanguageSql = (userExpr: string) =>
  `(SELECT language FROM user WHERE id=${userExpr})`;

/** ブラウザの言語（Accept-Language）から決める。ログインしていない人に見せるページ用 */
export function requestLanguage(acceptLanguage: string | null | undefined): AppLanguage {
  // q の大きい順（同じ q は書かれた順）。q=0 は「受け付けない」なので外す
  const accepted = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag?.trim(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((a) => a.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map((a) => a.tag);
  for (const tag of accepted) {
    const lang = normalizeLanguage(tag);
    if (lang) return lang;
  }
  return DEFAULT_LANGUAGE;
}
