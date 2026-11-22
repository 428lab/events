/**
 * ページごとの横幅（PC で画面の横幅を使う。オーナー指摘 2026-11-22
 * 「横を広げても画面の中心だけ使って左右の隙間がもったいない」）。
 *
 * - `full`: 作業領域を最大化する編集画面（スライド・配信セットの編集）
 * - `wide`: 一覧・表・カードが並ぶ画面。共通の器の上限を xl（1536px）にする
 * - `readable`: 入力フォーム・設定・1本のやり取り・長い本文。行が長くなりすぎないよう
 *   これまでの器と同じ 900px（MUI の md）に収める
 *
 * 判定はここ1か所だけ（Layout と PublicLayout が使う）。スマホ・タブレット（md 未満）は
 * どれも画面幅いっぱいで、見え方は変わらない。
 */
export type PageWidth = "full" | "wide" | "readable";

/** 入力フォーム・設定・1本のやり取り・長い本文のページ */
const READABLE: RegExp[] = [
  /^\/account$/,
  /^\/notifications$/,
  /^\/following$/,
  /^\/staff-invites$/,
  /^\/event-invites$/,
  /^\/inquiries(\/[^/]+)?$/,
  /^\/admin\/inquiries\/[^/]+$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/communities\/new$/,
  /^\/c\/[^/]+\/edit$/,
  /^\/requests\/new$/,
  /^\/requests\/[^/]+$/,
  /^\/venues\/new$/,
  /^\/venues\/[^/]+(\/edit)?$/,
  /^\/events\/new$/,
  /^\/events\/[^/]+\/(edit|broadcast|criteria|pre-survey|warikan|inquiries\/[^/]+)$/,
  /^\/decks\/import$/,
  /^\/s\/[^/]+$/,
  /^\/m\/[^/]+$/,
  /^\/login(\/.*)?$/,
];

export function pageWidth(pathname: string): PageWidth {
  if ((pathname.startsWith("/decks/") || pathname.startsWith("/live-sets/")) && pathname.endsWith("/edit")) {
    return "full";
  }
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return READABLE.some((re) => re.test(path)) ? "readable" : "wide";
}

/** 共通の器（MUI Container）の maxWidth。readable は MUI の md（900px）で、これまでの器と同じ */
export function containerMaxWidth(width: PageWidth): "md" | "xl" | false {
  return width === "full" ? false : width === "wide" ? "xl" : "md";
}
