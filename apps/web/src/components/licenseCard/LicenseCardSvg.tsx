import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { BADGE_DEFS } from "@eventer/shared";
import {
  ARC_CIRCLES,
  FLOW_BAND,
  FLOW_LINES,
  ROSETTE_CURVES,
  ROSETTE_WAVES,
  TOPO_CONTOURS,
} from "./patternData.js";

/** プロフィールカードのSVG本体 (#178)。
 * 承認済みモックアップ type-T1.svg のレイアウト（1074x650・56pxマージングリッド）を
 * 忠実に移植し、実データ（公開プロフィールAPI）を流し込む。
 * ページ側の都合（MUI・書き出し処理）に依存しない純粋な描画モジュール。 */

// ---------------------------------------------------------------------------
// 定数（モックアップ type-T1.svg 由来の値）
// ---------------------------------------------------------------------------

/** カードの論理サイズ（91×55mm の名刺比率） */
const CARD_W = 1074;
const CARD_H = 650;
/** PNG書き出しサイズ（2倍） */
export const EXPORT_W = 2148;
export const EXPORT_H = 1300;

/** 見出し系フォント。モックの Avenir Next はmacOS限定のため、
 * アプリ同梱の Plus Jakarta Sans（700/600）で置き換える */
const FONT_SANS = "'Plus Jakarta Sans', system-ui, sans-serif";
/** データ系（NO./XP/ISSUED等）の等幅フォントスタック */
const FONT_MONO = "ui-monospace, Menlo, Consolas, monospace";

/** インク色（モックアップの配色）。テーマによらず固定 */
const INK = "#0E1426";
const INK_SUB = "#5A6491";
const INK_FAINT = "#6B7499";

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
function themedPatternColor(color: string, theme: CardTheme): string {
  if (color === "#4F46E5") return theme.accentA;
  if (color === "#0EA5A0") return theme.accentB;
  if (color === "#2DD4BF") return theme.accentBLight;
  return color;
}

// ---------------------------------------------------------------------------
// 部品
// ---------------------------------------------------------------------------

/** ロゴグリフ（ヘッダー・ウォーターマーク共用）。64x64グリッドの座標系 */
function LogoGlyph({ color }: { color: string }) {
  return (
    <>
      <g fill={color}>
        <circle cx={32} cy={14.5} r={1.6} />
        <polygon points="32,15 11,30 53,30" />
        <circle cx={24} cy={35.5} r={2.4} />
        <circle cx={32} cy={35.5} r={2.4} />
        <circle cx={40} cy={35.5} r={2.4} />
      </g>
      <path
        d="M24 41 L40 41 L44 54 L20 54 Z"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
      />
    </>
  );
}

/** 背景パターン（4種）。パスデータはモックアップからの逐語移植。
 * 色のみ描画時にテーマへ写像する（themedPatternColor） */
function BackgroundPattern({
  variant,
  theme,
}: {
  variant: CardBgVariant;
  theme: CardTheme;
}) {
  if (variant === "rosette") {
    return (
      <>
        {ROSETTE_WAVES.map((p, i) => (
          <path
            key={`w${i}`}
            d={p.d}
            fill="none"
            stroke={themedPatternColor(p.stroke, theme)}
            strokeWidth={p.strokeWidth}
            opacity={p.opacity}
          />
        ))}
        {ROSETTE_CURVES.map((p, i) => (
          <path
            key={`r${i}`}
            d={p.d}
            fill="none"
            stroke={themedPatternColor(p.stroke, theme)}
            strokeWidth={p.strokeWidth}
            opacity={p.opacity}
          />
        ))}
      </>
    );
  }
  if (variant === "topo") {
    return (
      <>
        {TOPO_CONTOURS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={themedPatternColor(p.stroke, theme)}
            strokeWidth={p.strokeWidth}
            opacity={p.opacity}
          />
        ))}
      </>
    );
  }
  if (variant === "arcs") {
    return (
      <>
        {ARC_CIRCLES.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="none"
            stroke={theme.accentA}
            strokeWidth={c.strokeWidth}
            opacity={c.opacity}
          />
        ))}
      </>
    );
  }
  // flow
  return (
    <>
      {FLOW_LINES.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={themedPatternColor(p.stroke, theme)}
          strokeWidth={p.strokeWidth}
          opacity={p.opacity}
        />
      ))}
      <path
        d={FLOW_BAND.d}
        fill={themedPatternColor(FLOW_BAND.fill, theme)}
        opacity={FLOW_BAND.opacity}
      />
    </>
  );
}

/** QRコードパネル。モックアップと同じ 170x170・白パネル・静穏帯2モジュールで、
 * モジュール矩形の比率（6.3/6.8）とファインダーの描き方（枠線＋中央塗り）も踏襲する */
function QrPanel({ url }: { url: string }) {
  const qr = useMemo(() => {
    try {
      return QRCode.create(url, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [url]);
  if (!qr) return null;

  const size = qr.modules.size;
  const data = qr.modules.data;
  /** 静穏帯（2モジュール）込みのグリッド幅 */
  const grid = 170 / (size + 4);
  /** モジュール矩形（僅かな隙間を空けるモックの比率） */
  const cell = grid * (6.3 / 6.8);
  const off = grid * 2;
  /** ファインダーパターン（3隅の7x7）は個別に枠＋中央塗りで描くので除外 */
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  const modules: JSX.Element[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!data[r * size + c] || inFinder(r, c)) continue;
      modules.push(
        <rect
          key={`${r}-${c}`}
          x={off + c * grid}
          y={off + r * grid}
          width={cell}
          height={cell}
          fill={INK}
        />,
      );
    }
  }
  const finders = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ].map(([r, c], i) => (
    <g key={i}>
      {/* リング＝外周1モジュール分を正確に塗る（6×6枠＋stroke=1モジュール。
          中心線ストロークだと走査比が崩れて実機デコード不能になる） */}
      <rect
        x={off + (c + 0.5) * grid}
        y={off + (r + 0.5) * grid}
        width={6 * grid}
        height={6 * grid}
        fill="none"
        stroke={INK}
        strokeWidth={grid}
      />
      <rect
        x={off + (c + 2) * grid}
        y={off + (r + 2) * grid}
        width={3 * grid}
        height={3 * grid}
        fill={INK}
      />
    </g>
  ));

  return (
    <g transform="translate(823,408)">
      <rect width={170} height={170} rx={10} fill="#FFFFFF" stroke="#B9C2E2" />
      {modules}
      {finders}
    </g>
  );
}

/** カード表示用に整えたデータ */
export interface CardData {
  name: string;
  handle: string;
  avatarUrl: string | null;
  /** NO. 欄（EVL-＋ユーザーIDの先頭8文字大文字） */
  serial: string;
  /** ISSUED YYYY-MM-DD（登録日・ローカル時刻） */
  issued: string;
  level: number;
  xp: number;
  hosted: number;
  spoken: number;
  /** 参加率%（出席+無断欠席が0のときは null で非表示） */
  attendRate: number | null;
  /** 最上位バッジの英語名（未獲得なら null） */
  topBadge: string | null;
  /** 獲得バッジ総数（星の数として表示） */
  totalBadges: number;
  /** フッターに刷るサイトのドメイン */
  host: string;
  /** 参加イベント数の多い順・最大5コミュニティ（アイコン＋名前の帯表示用） */
  communities: { id: string; name: string; iconUrl: string | null }[];
}

/** toCardData が実際に読むプロフィールの範囲。
 * 公開プロフィール（UserProfile）はこれを満たすが、名札の一括印刷 (#304) は
 * 100人分をまとめて取るのでカードに出る値だけの軽量ペイロードを渡す。
 * どちらも同じ関数でカード化できるよう、必要な形だけを型にしてある */
export interface CardProfile {
  id: string;
  handle?: string;
  name: string;
  avatarUrl: string | null;
  createdAt: number;
  participation: {
    attended: number;
    noShow: number;
    hosted: number;
    spoken: number;
  };
  gamification: {
    level: number;
    xp: number;
    badges: readonly { key: string; tier: number }[];
  };
  /** myEventCount は無ければ 0 扱い（サーバー側で並べ替え済みの場合は順序を保つ） */
  communities: readonly {
    id: string;
    name: string;
    iconUrl: string | null;
    myEventCount?: number | null;
  }[];
}

export function toCardData(
  p: CardProfile,
  fallbackHandle: string,
  host: string,
): CardData {
  const d = new Date(p.createdAt);
  const issued = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const registered = p.participation.attended + p.participation.noShow;
  // 最上位バッジ（tier最大。同tierはBADGE_DEFS順の先頭）＋英語名の解決
  const badges = p.gamification.badges;
  const top = badges.reduce<(typeof badges)[number] | null>(
    (best, b) => (best == null || b.tier > best.tier ? b : best),
    null,
  );
  const topEn = top
    ? (BADGE_DEFS.find((def) => def.key === top.key)?.nameEn ??
      top.key.toUpperCase())
    : null;
  return {
    name: p.name,
    handle: p.handle ?? fallbackHandle,
    avatarUrl: p.avatarUrl,
    serial: `EVL-${p.id.slice(0, 8).toUpperCase()}`,
    issued,
    level: p.gamification.level,
    xp: p.gamification.xp,
    hosted: p.participation.hosted,
    spoken: p.participation.spoken,
    attendRate:
      registered > 0
        ? Math.round((p.participation.attended / registered) * 100)
        : null,
    topBadge: topEn,
    totalBadges: badges.length,
    host,
    communities: [...p.communities]
      .sort((a, b) => (b.myEventCount ?? 0) - (a.myEventCount ?? 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, iconUrl: c.iconUrl })),
  };
}

/** カード本体のSVG。レイアウト座標はすべて type-T1.svg の逐語移植。
 * ウォーターマークのみユーザー要望によりカード中央へ移動（スケール・不透明度は同一） */
export function LicenseCardSvg({
  card,
  variant,
  theme: themeKey,
  qrUrl,
  svgRef,
}: {
  card: CardData;
  variant: CardBgVariant;
  theme: CardThemeKey;
  qrUrl: string;
  /** PNG書き出し用の参照。名札の一括印刷 (#304) のように書き出さない用途では省略できる */
  svgRef?: React.RefObject<SVGSVGElement>;
}) {
  const { t } = useTranslation();
  const theme: CardTheme =
    CARD_THEMES.find((c) => c.key === themeKey) ?? CARD_THEMES[0];
  // アイコンが読み込めなかったか。URL が変わったらやり直す
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [card.avatarUrl]);
  const statsParts = [`HOSTED ${card.hosted}`, `TALKS ${card.spoken}`];
  if (card.attendRate != null) statsParts.push(`ATTEND ${card.attendRate}%`);
  // 長い表示名・バッジ名はパネル幅に収まるよう段階的に縮小（モックは kojira / FIRST HOST 想定）
  // 名前は長さに応じて連続的にフォントサイズを決める（段階だと極端な長さで破綻する）。
  // 幅見積り: CJK ≒ 1.0em / 欧文 ≒ 0.55em。下限まで縮めても収まらない場合のみ字間圧縮
  const NAME_MAX_W = 742;
  const nameWidthEm = [...card.name].reduce(
    (acc, ch) =>
      acc + (/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1.0 : 0.62),
    0,
  );
  // textLength はレンダラによって無視されるため使わない。
  // 安全係数 0.94 を掛けたサイズ計算のみで必ず枠内に収める（下限16px）
  const nameSize = Math.max(
    16,
    Math.min(72, Math.floor((NAME_MAX_W / Math.max(nameWidthEm, 1)) * 0.94)),
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      width={CARD_W}
      height={CARD_H}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={t("profile.cardAriaLabel", { name: card.name })}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        {/* 紙面のグラデーション（テーマ別）とホログラム風シアン（全テーマ共通） */}
        <linearGradient id="lc-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme.paper[0]} />
          <stop offset="0.5" stopColor={theme.paper[1]} />
          <stop offset="1" stopColor={theme.paper[2]} />
        </linearGradient>
        <linearGradient id="lc-sheen" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0.30" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.46" stopColor="#B7C4FF" stopOpacity="0.20" />
          <stop offset="0.54" stopColor="#9BE8DE" stopOpacity="0.16" />
          <stop offset="0.70" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <clipPath id="lc-avatar-clip">
          <rect x={798} y={140} width={220} height={220} rx={16} />
        </clipPath>
        <clipPath id="lc-card-clip">
          <rect width={CARD_W} height={CARD_H} rx={28} />
        </clipPath>
      </defs>
      <g clipPath="url(#lc-card-clip)">
        <rect width={CARD_W} height={CARD_H} rx={28} fill="url(#lc-bg)" />
        <BackgroundPattern variant={variant} theme={theme} />
        {/* ウォーターマーク: モックは translate(560,60) だがユーザー要望でカード中央へ
            （グリフの外接中心 (32,34) を 8.6倍でカード中心 (537,325) に合わせる） */}
        <g transform="translate(261.8,32.6) scale(8.6)" opacity={0.07}>
          <LogoGlyph color={theme.watermark} />
        </g>
        <rect width={CARD_W} height={CARD_H} fill="url(#lc-sheen)" opacity={0.16} />
        <rect x={0} y={0} width={CARD_W} height={8} fill={theme.accentA} />

        {/* ヘッダー: ロゴ＋ワードマーク＋シリアル */}
        <g transform="translate(56,44) scale(1.35)">
          <LogoGlyph color={theme.accentA} />
        </g>
        <text
          x={160}
          y={86}
          fontFamily={FONT_SANS}
          fontSize={44}
          fontWeight={700}
          fill={INK}
          letterSpacing={10}
        >
          EVENTS LAB
        </text>
        <text
          x={1018}
          y={82}
          textAnchor="end"
          fontFamily={FONT_MONO}
          fontSize={17}
          fill={INK_FAINT}
        >
          NO. {card.serial}
        </text>

        {/* アバター（画像が無い/取れない場合は下のイニシャル矩形が見える） */}
        <rect
          x={798}
          y={140}
          width={220}
          height={220}
          rx={16}
          fill="#fff"
          stroke="#AEB8DD"
          strokeWidth={2}
        />
        <rect x={798} y={140} width={220} height={220} rx={16} fill="#E8ECF9" />
        <text
          x={908}
          y={250}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={FONT_SANS}
          fontSize={100}
          fontWeight={700}
          fill={theme.accentA}
        >
          {card.name.charAt(0)}
        </text>
        {card.avatarUrl && !avatarFailed && (
          <image
            data-avatar="1"
            href={card.avatarUrl}
            // 読み込めなかったら消して、下に描いてある名前の1文字目を見せる。
            // 消さないと壊れた画像がイニシャルの上に重なる（他の画面はイニシャルに
            // フォールバックするので、カードだけ見え方が違っていた）
            onError={() => setAvatarFailed(true)}
            x={798}
            y={140}
            width={220}
            height={220}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#lc-avatar-clip)"
          />
        )}

        {/* 表示名＋ハンドル */}
        <text
          x={56}
          y={226}
          fontFamily={FONT_SANS}
          fontSize={nameSize}
          fontWeight={700}
          fill={INK}
        >
          {card.name}
        </text>
        <text
          x={58}
          y={260}
          fontFamily={FONT_MONO}
          fontSize={Math.max(
            11,
            Math.min(19, Math.floor((NAME_MAX_W / ((card.handle.length + 1) * 0.62)) * 0.94)),
          )}
          fill={INK_SUB}
        >
          @{card.handle}
        </text>

        {/* プロフィールパネル */}
        <g transform="translate(56,300)">
          <rect
            width={620}
            height={160}
            rx={18}
            fill="#FFFFFF"
            fillOpacity={0.72}
            stroke="#B9C2E2"
          />
          <text
            x={28}
            y={40}
            fontFamily={FONT_SANS}
            fontSize={16}
            fontWeight={600}
            fill={theme.accentDeep}
            letterSpacing={4}
          >
            ORGANIZER PROFILE
          </text>
          <text
            x={28}
            y={98}
            fontFamily={FONT_SANS}
            fontSize={52}
            fontWeight={700}
            fill={INK}
          >
            Lv.{card.level}
          </text>
          <text x={160} y={98} fontFamily={FONT_MONO} fontSize={20} fill={INK_SUB}>
            XP {card.xp}
          </text>
          <text x={28} y={136} fontFamily={FONT_MONO} fontSize={18} fill="#232B4D">
            {statsParts.join(" ・ ")}
          </text>
          {card.topBadge && (
            <>
              <text
                x={404}
                y={52}
                fontFamily={FONT_SANS}
                fontSize={15}
                fontWeight={600}
                fill={INK_FAINT}
                letterSpacing={3}
              >
                BADGES
              </text>
              {/* 星＝獲得バッジ総数（6個で折り返し・最大12） */}
              {Array.from({ length: Math.min(card.totalBadges, 12) }).map(
                (_, si) => (
                  <text
                    key={si}
                    x={404 + (si % 6) * 30}
                    y={84 + Math.floor(si / 6) * 28}
                    fontFamily={FONT_SANS}
                    fontSize={24}
                    fill="#D99A0B"
                  >
                    ★
                  </text>
                ),
              )}
              {/* 代表（最上位）バッジ名は小さめテキストで */}
              <text
                x={404}
                y={card.totalBadges > 6 ? 138 : 112}
                fontFamily={FONT_SANS}
                fontSize={15}
                fontWeight={700}
                fill="#A8720A"
                letterSpacing={1}
              >
                {card.topBadge}
              </text>
            </>
          )}
        </g>

        {/* 所属コミュニティ帯（参加数順トップ5・#181）。パネル下・QRの左 */}
        {card.communities.length > 0 && (
          <g transform="translate(56,486)">
            <text
              fontFamily={FONT_SANS}
              fontSize={13}
              fontWeight={600}
              fill={theme.accentDeep}
              letterSpacing={3}
            >
              COMMUNITIES
            </text>
            {card.communities.map((c, i) => {
              // アイコン主役の大きめチップ（アイコン52px・縦68px）。
              // 5個並べてもQR（x=823）に届かないよう、個数に応じて幅を自動調整
              const AVAIL_W = 823 - 56 - 10;
              const n = card.communities.length;
              const CHIP_W = Math.min(150, Math.floor((AVAIL_W - (n - 1) * 8) / n));
              const CHIP_H = 68;
              const ICON = 52;
              const x = i * (CHIP_W + 8);
              // 長い名前は2行に折り返す（縮めすぎない）。それでも溢れる分だけ縮小
              const LABEL_W = CHIP_W - 68 - 8;
              const unitOf = (ch: string) =>
                /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.62;
              const totalUnits = [...c.name].reduce((a, ch) => a + unitOf(ch), 0);
              // 2行に収まる最大サイズ（9〜14px）
              const labelSize = Math.max(
                9,
                Math.min(14, Math.floor(((LABEL_W * 2) / Math.max(totalUnits, 1)) * 0.94)),
              );
              // 幅ベースの貪欲改行（最大2行。2行目に収まらない場合はサイズ下限で押し込む）
              const maxUnitsPerLine = LABEL_W / labelSize;
              const lines: string[] = [];
              let cur = "";
              let curUnits = 0;
              for (const ch of c.name) {
                const u = unitOf(ch);
                if (curUnits + u > maxUnitsPerLine && lines.length < 1) {
                  lines.push(cur);
                  cur = ch;
                  curUnits = u;
                } else {
                  cur += ch;
                  curUnits += u;
                }
              }
              if (cur) lines.push(cur);
              return (
                <g key={c.id} transform={`translate(${x},12)`}>
                  <rect
                    width={CHIP_W}
                    height={CHIP_H}
                    rx={14}
                    fill="#FFFFFF"
                    fillOpacity={0.72}
                    stroke="#B9C2E2"
                  />
                  <clipPath id={`lc-comicon-${i}`}>
                    <rect x={8} y={8} width={ICON} height={ICON} rx={12} />
                  </clipPath>
                  <rect x={8} y={8} width={ICON} height={ICON} rx={12} fill="#E3E8F6" />
                  {c.iconUrl ? (
                    <image
                      href={c.iconUrl}
                      x={8}
                      y={8}
                      width={ICON}
                      height={ICON}
                      clipPath={`url(#lc-comicon-${i})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <text
                      x={8 + ICON / 2}
                      y={8 + ICON / 2 + 8}
                      textAnchor="middle"
                      fontFamily={FONT_SANS}
                      fontSize={24}
                      fontWeight={700}
                      fill={INK_SUB}
                    >
                      {[...c.name][0] ?? "?"}
                    </text>
                  )}
                  <text
                    x={68}
                    y={
                      lines.length > 1
                        ? CHIP_H / 2 - labelSize / 2 + 3
                        : CHIP_H / 2 + 5
                    }
                    fontFamily={FONT_SANS}
                    fontSize={labelSize}
                    fontWeight={600}
                    fill="#232B4D"
                  >
                    {lines.map((line, li) => (
                      <tspan key={li} x={68} dy={li === 0 ? 0 : labelSize + 3}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* QRコード（公開プロフィールURL） */}
        <QrPanel url={qrUrl} />
        <text
          x={908}
          y={608}
          textAnchor="middle"
          fontFamily={FONT_MONO}
          fontSize={13}
          fill={INK_FAINT}
        >
          PROFILE
        </text>
        <text x={56} y={608} fontFamily={FONT_MONO} fontSize={16} fill={INK_SUB}>
          ISSUED {card.issued} ・ {card.host}
        </text>
      </g>
    </svg>
  );
}

