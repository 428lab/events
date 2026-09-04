import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundPattern, LogoGlyph } from "./CardDecor.js";
import { QrPanel } from "./QrPanel.js";
import { charUnits, fitFontSize, textUnits } from "./cardText.js";
import {
  AVATAR,
  CARD_H,
  CARD_W,
  MARGIN_X,
  NAME_MAX_W,
  QR,
} from "./cardLayout.js";
import {
  CARD_THEMES,
  FONT_MONO,
  FONT_SANS,
  INK,
  INK_FAINT,
  INK_SUB,
  type CardBgVariant,
  type CardTheme,
  type CardThemeKey,
} from "./cardTheme.js";
import type { CardData } from "./cardData.js";

/** プロフィールカードのSVG本体 (#178)。
 * 承認済みモックアップ type-T1.svg のレイアウト（1074x650・56pxマージングリッド）を
 * 忠実に移植し、実データ（公開プロフィールAPI）を流し込む。
 * ページ側の都合（MUI・書き出し処理）に依存しない純粋な描画モジュール。
 *
 * **このファイルはカード1枚の絵で、これ以上は割らない** (#466)。
 * ヘッダー・アバター・表示名・プロフィールパネル・コミュニティ帯は、
 * 互いの座標を見ながら1枚に収まるよう決めた1つのレイアウトなので、
 * 部品に切ると「隣に何があるか」が読めなくなる（帯の幅がQRの位置で決まる、など）。
 * 絵でないもの（配色カタログ・座標定数・文字幅の見積り・データ変換・QRの符号化）は
 * すべて隣のモジュールへ出してある。 */
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
  // 長い表示名・バッジ名はパネル幅に収まるよう縮小（モックは kojira / FIRST HOST 想定）。
  // 段階だと極端な長さで破綻するので、長さから連続的にサイズを決める（cardText.ts）
  const nameSize = fitFontSize(NAME_MAX_W, textUnits(card.name), 16, 72);
  // ハンドルは常に欧文なので、字種を見ずに桁数だけで見積もる（@ の分を1文字足す）
  const handleSize = fitFontSize(
    NAME_MAX_W,
    (card.handle.length + 1) * 0.62,
    11,
    19,
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
          <rect
            x={AVATAR.x}
            y={AVATAR.y}
            width={AVATAR.size}
            height={AVATAR.size}
            rx={AVATAR.r}
          />
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
        <g transform={`translate(${MARGIN_X},44) scale(1.35)`}>
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
          x={AVATAR.x}
          y={AVATAR.y}
          width={AVATAR.size}
          height={AVATAR.size}
          rx={AVATAR.r}
          fill="#fff"
          stroke="#AEB8DD"
          strokeWidth={2}
        />
        <rect
          x={AVATAR.x}
          y={AVATAR.y}
          width={AVATAR.size}
          height={AVATAR.size}
          rx={AVATAR.r}
          fill="#E8ECF9"
        />
        <text
          x={AVATAR.x + AVATAR.size / 2}
          y={AVATAR.y + AVATAR.size / 2}
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
            x={AVATAR.x}
            y={AVATAR.y}
            width={AVATAR.size}
            height={AVATAR.size}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#lc-avatar-clip)"
          />
        )}

        {/* 表示名＋ハンドル */}
        <text
          x={MARGIN_X}
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
          fontSize={handleSize}
          fill={INK_SUB}
        >
          @{card.handle}
        </text>

        {/* プロフィールパネル */}
        <g transform={`translate(${MARGIN_X},300)`}>
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
          <g transform={`translate(${MARGIN_X},486)`}>
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
              // 5個並べてもQRに届かないよう、個数に応じて幅を自動調整
              const AVAIL_W = QR.x - MARGIN_X - 10;
              const n = card.communities.length;
              const CHIP_W = Math.min(150, Math.floor((AVAIL_W - (n - 1) * 8) / n));
              const CHIP_H = 68;
              const ICON = 52;
              const x = i * (CHIP_W + 8);
              // 長い名前は2行に折り返す（縮めすぎない）。それでも溢れる分だけ縮小
              const LABEL_W = CHIP_W - 68 - 8;
              const totalUnits = textUnits(c.name);
              // 2行に収まる最大サイズ（9〜14px）
              const labelSize = fitFontSize(LABEL_W * 2, totalUnits, 9, 14);
              // 幅ベースの貪欲改行（最大2行。2行目に収まらない場合はサイズ下限で押し込む）
              const maxUnitsPerLine = LABEL_W / labelSize;
              const lines: string[] = [];
              let cur = "";
              let curUnits = 0;
              for (const ch of c.name) {
                const u = charUnits(ch);
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
          x={QR.x + QR.size / 2}
          y={608}
          textAnchor="middle"
          fontFamily={FONT_MONO}
          fontSize={13}
          fill={INK_FAINT}
        >
          PROFILE
        </text>
        <text
          x={MARGIN_X}
          y={608}
          fontFamily={FONT_MONO}
          fontSize={16}
          fill={INK_SUB}
        >
          ISSUED {card.issued} ・ {card.host}
        </text>
      </g>
    </svg>
  );
}
