import { useMemo } from "react";
import QRCode from "qrcode";
import { BADGE_DEFS } from "@eventer/shared";
import type { UserProfile } from "@eventer/shared";
import {
  ARC_CIRCLES,
  FLOW_BAND,
  FLOW_LINES,
  ROSETTE_CURVES,
  ROSETTE_WAVES,
  TOPO_CONTOURS,
} from "./patternData.js";

/** ライセンスカードのSVG本体 (#178)。
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

/** インク色（モックアップの配色） */
const INK = "#0E1426";
const INK_SUB = "#5A6491";
const INK_FAINT = "#6B7499";
const INDIGO = "#4F46E5";

/** 背景パターンの選択肢。rosette がデフォルト（type-T1.svg 本体の背景） */
export const BG_VARIANTS = [
  { key: "rosette", label: "ロゼット" },
  { key: "topo", label: "等高線" },
  { key: "arcs", label: "円弧" },
  { key: "flow", label: "流線" },
] as const;
export type CardBgVariant = (typeof BG_VARIANTS)[number]["key"];

/** 背景パターン選択の保存先 */
export const BG_STORAGE_KEY = "eventer:cardBg";

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

/** 背景パターン（4種）。パスデータはモックアップからの逐語移植 */
function BackgroundPattern({ variant }: { variant: CardBgVariant }) {
  if (variant === "rosette") {
    return (
      <>
        {ROSETTE_WAVES.map((p, i) => (
          <path
            key={`w${i}`}
            d={p.d}
            fill="none"
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            opacity={p.opacity}
          />
        ))}
        {ROSETTE_CURVES.map((p, i) => (
          <path
            key={`r${i}`}
            d={p.d}
            fill="none"
            stroke={p.stroke}
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
            stroke={p.stroke}
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
            stroke={INDIGO}
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
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          opacity={p.opacity}
        />
      ))}
      <path d={FLOW_BAND.d} fill={FLOW_BAND.fill} opacity={FLOW_BAND.opacity} />
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
    <g transform="translate(848,408)">
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
  /** 最上位以外の獲得バッジ数 */
  moreBadges: number;
  /** フッターに刷るサイトのドメイン */
  host: string;
  /** 参加イベント数の多い順・最大5コミュニティ（アイコン＋名前の帯表示用） */
  communities: { id: string; name: string; iconUrl: string | null }[];
}

export function toCardData(
  p: UserProfile,
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
    moreBadges: top ? badges.length - 1 : 0,
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
  qrUrl,
  svgRef,
}: {
  card: CardData;
  variant: CardBgVariant;
  qrUrl: string;
  svgRef: React.RefObject<SVGSVGElement>;
}) {
  const statsParts = [`HOSTED ${card.hosted}`, `TALKS ${card.spoken}`];
  if (card.attendRate != null) statsParts.push(`ATTEND ${card.attendRate}%`);
  // 長い表示名・バッジ名はパネル幅に収まるよう段階的に縮小（モックは kojira / FIRST HOST 想定）
  // CJK文字は全角幅（≒フォントサイズ）で数え、実効幅からサイズを決める。
  // それでも収まらない場合は textLength で圧縮してアバター枠への重なりを防ぐ
  const nameUnits = [...card.name].reduce(
    (acc, ch) => acc + (/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1),
    0,
  );
  const nameSize = nameUnits > 18 ? 44 : nameUnits > 12 ? 52 : 72;
  const NAME_MAX_W = 742;
  const nameEstW = nameUnits * nameSize * 0.62;
  const nameLenAttrs =
    nameEstW > NAME_MAX_W
      ? { textLength: NAME_MAX_W, lengthAdjust: "spacingAndGlyphs" as const }
      : {};
  const badgeSize = (card.topBadge?.length ?? 0) > 12 ? 19 : 26;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      width={CARD_W}
      height={CARD_H}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${card.name} のライセンスカード`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        {/* 紙面のグラデーションとホログラム風シアン（全バリアント共通） */}
        <linearGradient id="lc-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C9D2EC" />
          <stop offset="0.5" stopColor="#DFE5F6" />
          <stop offset="1" stopColor="#BFC9E8" />
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
        <BackgroundPattern variant={variant} />
        {/* ウォーターマーク: モックは translate(560,60) だがユーザー要望でカード中央へ
            （グリフの外接中心 (32,34) を 8.6倍でカード中心 (537,325) に合わせる） */}
        <g transform="translate(261.8,32.6) scale(8.6)" opacity={0.07}>
          <LogoGlyph color="#3B3F73" />
        </g>
        <rect width={CARD_W} height={CARD_H} fill="url(#lc-sheen)" opacity={0.16} />
        <rect x={0} y={0} width={CARD_W} height={8} fill={INDIGO} />

        {/* ヘッダー: ロゴ＋ワードマーク＋シリアル */}
        <g transform="translate(56,44) scale(1.35)">
          <LogoGlyph color={INDIGO} />
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
          fill={INDIGO}
        >
          {card.name.charAt(0)}
        </text>
        {card.avatarUrl && (
          <image
            data-avatar="1"
            href={card.avatarUrl}
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
          {...nameLenAttrs}
          fontWeight={700}
          fill={INK}
        >
          {card.name}
        </text>
        <text x={58} y={260} fontFamily={FONT_MONO} fontSize={19} fill={INK_SUB}>
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
            fill="#4338CA"
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
                y={72}
                fontFamily={FONT_SANS}
                fontSize={15}
                fontWeight={600}
                fill={INK_FAINT}
                letterSpacing={3}
              >
                BADGE
              </text>
              <text
                x={404}
                y={112}
                fontFamily={FONT_SANS}
                fontSize={badgeSize}
                fontWeight={700}
                fill="#A8720A"
              >
                ★ {card.topBadge}
                {card.moreBadges > 0 && (
                  <tspan fontSize={16} fill={INK_FAINT} dx={8}>
                    +{card.moreBadges}
                  </tspan>
                )}
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
              fill="#4338CA"
              letterSpacing={3}
            >
              COMMUNITIES
            </text>
            {card.communities.map((c, i) => {
              const CHIP_W = 148;
              const x = i * (CHIP_W + 8);
              const label =
                [...c.name].length > 7
                  ? [...c.name].slice(0, 7).join("") + "…"
                  : c.name;
              return (
                <g key={c.id} transform={`translate(${x},12)`}>
                  <rect
                    width={CHIP_W}
                    height={44}
                    rx={12}
                    fill="#FFFFFF"
                    fillOpacity={0.72}
                    stroke="#B9C2E2"
                  />
                  <clipPath id={`lc-comicon-${i}`}>
                    <rect x={8} y={8} width={28} height={28} rx={7} />
                  </clipPath>
                  <rect x={8} y={8} width={28} height={28} rx={7} fill="#E3E8F6" />
                  {c.iconUrl ? (
                    <image
                      href={c.iconUrl}
                      x={8}
                      y={8}
                      width={28}
                      height={28}
                      clipPath={`url(#lc-comicon-${i})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <text
                      x={22}
                      y={30}
                      textAnchor="middle"
                      fontFamily={FONT_SANS}
                      fontSize={16}
                      fontWeight={700}
                      fill={INK_SUB}
                    >
                      {[...c.name][0] ?? "?"}
                    </text>
                  )}
                  <text
                    x={44}
                    y={29}
                    fontFamily={FONT_SANS}
                    fontSize={15}
                    fontWeight={600}
                    fill="#232B4D"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* QRコード（公開プロフィールURL） */}
        <QrPanel url={qrUrl} />
        <text
          x={933}
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

