/** ライセンスカードの配色カタログ (#178)。
 *
 * カードの「絵」ではなく、絵に流し込む**色の一覧**を持つ。
 * 描画 (`LicenseCardSvg.tsx`) だけでなく、配色ピッカー (`LicenseCardPage.tsx`) と
 * 保存値の正規化 (`cardLook.ts`) も同じ一覧を引く。
 * 以前は描画コンポーネントのファイルに同居していたため、色の一覧が欲しいだけの
 * `cardLook.ts` が React コンポーネントを import していた (#466 で切り出し)。
 *
 * 値はすべて承認済みモックアップ type-T1.svg 由来。 */

/** 見出し系フォント。モックの Avenir Next はmacOS限定のため、
 * アプリ同梱の Plus Jakarta Sans（700/600）で置き換える */
export const FONT_SANS = "'Plus Jakarta Sans', system-ui, sans-serif";
/** データ系（NO./XP/ISSUED等）の等幅フォントスタック */
export const FONT_MONO = "ui-monospace, Menlo, Consolas, monospace";

/** インク色（モックアップの配色）。テーマによらず固定 */
export const INK = "#0E1426";
export const INK_SUB = "#5A6491";
export const INK_FAINT = "#6B7499";

/** 背景パターンの選択肢。rosette がデフォルト（type-T1.svg 本体の背景） */
export const BG_VARIANTS = [
  { key: "rosette", label: "ロゼット" },
  { key: "topo", label: "等高線" },
  { key: "arcs", label: "円弧" },
  { key: "flow", label: "流線" },
] as const;
export type CardBgVariant = (typeof BG_VARIANTS)[number]["key"];

/** カード配色テーマ。
 * - paper: 紙面グラデーション3ストップ
 * - accentA: 主アクセント（パターン主線・上端バー・ロゴ・イニシャル）
 * - accentB: 副アクセント（ロゼット曲線などの副線）
 * - accentBLight: 副アクセントの淡色（等高線パターンの明るい線 #2DD4BF 相当）
 * - accentDeep: 濃色アクセント（ORGANIZER PROFILE / COMMUNITIES ラベル）
 * - watermark: 中央ウォーターマークのグリフ色
 * インク（文字）色とバッジの金色はテーマ間で共通 */
export interface CardTheme {
  key: string;
  name: string;
  paper: readonly [string, string, string];
  accentA: string;
  accentB: string;
  accentBLight: string;
  accentDeep: string;
  watermark: string;
}

/** 配色テーマの選択肢。indigo がデフォルト（従来配色そのまま） */
export const CARD_THEMES = [
  {
    key: "indigo",
    name: "インディゴ",
    paper: ["#C9D2EC", "#DFE5F6", "#BFC9E8"],
    accentA: "#4F46E5",
    accentB: "#0EA5A0",
    accentBLight: "#2DD4BF",
    accentDeep: "#4338CA",
    watermark: "#3B3F73",
  },
  {
    key: "teal",
    name: "ティール",
    paper: ["#C7E4E0", "#E0F3F0", "#BBDCD7"],
    accentA: "#0D9488",
    accentB: "#4F46E5",
    accentBLight: "#818CF8",
    accentDeep: "#0F766E",
    watermark: "#2F5B55",
  },
  {
    key: "rose",
    name: "ローズ",
    paper: ["#EED2DE", "#F8E6EE", "#E5C4D4"],
    accentA: "#DB2777",
    accentB: "#7C3AED",
    accentBLight: "#A78BFA",
    accentDeep: "#BE185D",
    watermark: "#6B3B52",
  },
  {
    key: "amber",
    name: "アンバー",
    paper: ["#EBDFC7", "#F6EEDC", "#E2D4B8"],
    accentA: "#B45309",
    accentB: "#4F46E5",
    accentBLight: "#818CF8",
    accentDeep: "#92400E",
    watermark: "#6B5636",
  },
  {
    key: "mono",
    name: "モノクロ",
    paper: ["#D9DDE4", "#EDF0F4", "#CDD2DA"],
    accentA: "#334155",
    accentB: "#64748B",
    accentBLight: "#94A3B8",
    accentDeep: "#1E293B",
    watermark: "#3A4356",
  },
] as const satisfies readonly CardTheme[];
export type CardThemeKey = (typeof CARD_THEMES)[number]["key"];

/** patternData.ts に焼き込まれたストローク色をテーマ色へ差し替える。
 * 生成データ（indigo基準: #4F46E5 / #0EA5A0 / #2DD4BF）は編集せず、描画時に写像する */
export function themedPatternColor(color: string, theme: CardTheme): string {
  if (color === "#4F46E5") return theme.accentA;
  if (color === "#0EA5A0") return theme.accentB;
  if (color === "#2DD4BF") return theme.accentBLight;
  return color;
}
