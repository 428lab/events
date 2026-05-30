---
version: alpha
name: Natsumatsuri
description: events lab の視覚的アイデンティティ。夜祭（夏祭り）の高揚感をダーク基調で表現する。
colors:
  primary: "#2DD4BF"
  on-primary: "#06231D"
  primary-dark: "#14B8A6"
  secondary: "#FB923C"
  on-secondary: "#2A1400"
  festive-pink: "#FB7185"
  festive-gold: "#FBBF24"
  background: "#0E1426"
  surface: "#1A2238"
  surface-2: "#222C46"
  on-surface: "#EAF0F7"
  muted: "#97A3BC"
  border: "#2A3350"
  success: "#34D399"
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.5rem
    fontWeight: 800
    letterSpacing: "-0.02em"
    lineHeight: "1.1"
  h1:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: 800
    letterSpacing: "-0.01em"
  h2:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: 700
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: 400
    lineHeight: "1.6"
  label:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: 700
    letterSpacing: "0.04em"
rounded:
  sm: 10px
  md: 14px
  lg: 20px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: 10px 20px
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 20px
  chip-accent:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    rounded: "{rounded.pill}"
---

## Overview

**Natsumatsuri（夏祭り）** — 夜祭の空のようなダークを基調に、提灯の灯りのようなティールと、祭りの暖色（アンバー／花火のピンク・ゴールド）でポップに賑やかさを添える。
普段の運営画面は夜空の落ち着き（暗くて読みやすい）。当日のプレゼン・表彰では、提灯やぼんぼり、花火のように彩度の高い色とモーションで一気に盛り上げる。「夜の縁日」を歩く高揚感が指針。

## Colors

夜空のダーク面を土台に、操作色（提灯ティール）と祭りの暖色アクセントで構成する。

- **Primary (#2DD4BF):** 提灯ティール。ボタン・リンク・選択など「操作」を担うブランド色。暗背景で映える明るいティール。
- **Background (#0E1426):** 夜祭の空。アプリ全体の背景。
- **Surface (#1A2238) / Surface-2 (#222C46):** 提灯まわりの面。背景との明度差＋細い border で階層を作る。
- **Secondary (#FB923C):** 灯り（提灯）のアンバー。お祝い・特別な状態バッジ・表彰の暖色に。
- **Festive Pink (#FB7185) / Gold (#FBBF24):** 花火の彩り。表彰の演出（紙吹雪・グラデ）に限定して使う。
- **On-surface (#EAF0F7) / Muted (#97A3BC):** 本文と補足。純白は避け、やや青みのある白。
- **Border (#2A3350):** 夜に沈む細い罫線。影に頼らず面を区切る。

操作＝ティール、祝福＝暖色（アンバー／ピンク／ゴールド）と役割を分ける。1要素で両系統を同時に強く使わない。

## Typography

書体は **Plus Jakarta Sans**。暗背景に太いウェイトの見出しがよく映える。見出しは 700–800・字詰め、本文は行間 1.6、ラベルは小さく太字で字間広め。サイズ段階は増やしすぎない。

## Layout

中央寄せ単一カラム（最大 ~960px）を基本。情報の多いイベント詳細のみ本体＋右サイド（参加者など）の2カラム。余白は 4/8/16/24/40 のスケール。カードで面をグルーピングし、暗い背景と少し明るい surface のコントラスト＋細罫線で区切る。

## Elevation & Depth

暗いトーンでは影が効きにくいので、階層は「面の明度差（background → surface → surface-2）＋ 細い border」で表現する。強い発色と大きめの影は、**プレゼンの主役**と**表彰の受賞カード**にだけ使い、夜祭のスポットのように主役を浮かせる。

## Shapes

角丸は中庸（sm 10 / md 14 / lg 20px）。ボタンは pill 形で軽快に。鋭角は使わず、提灯のように柔らかい印象を保つ。

## Components

- **button-primary:** ティール地・暗い文字・pill。ホバーで一段濃いティール。ラベルは大文字化しない。
- **card:** surface 地・md 角丸・細 border・影なし。
- **chip-accent:** アンバー地。「運営管理者」「表彰式」など祭り側の特別バッジに。通常状態のチップは控えめなニュートラル。
- **AppBar:** 左から提灯ティールがにじむ夜空グラデ（`#0B3A34 → background`）。
- 表彰カードはティール→アンバーのグラデで「灯り」を表現。

## Do's and Don'ts

- **Do** 操作はティール、祝福・表彰は暖色、と役割を一貫させる。
- **Do** 普段は夜空の落ち着き（暗・高可読）。賑やかさは演出に集中。
- **Do** 見出しは太く短く。1画面に display 見出しは1つまで。
- **Don't** ティールと暖色を同一要素で同時に強調しない。
- **Don't** 純黒・純白の多用、影の多用をしない。階層は面の明度差と罫線で。
- **Don't** 通常画面で花火色（ピンク/ゴールド）を多用しない。演出専用に取っておく。
