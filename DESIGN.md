---
version: alpha
name: Spotlight
description: events lab の視覚的アイデンティティ。イベントの高揚感と運営の信頼感を両立する。
colors:
  primary: "#4F46E5"
  on-primary: "#FFFFFF"
  primary-container: "#EEF0FF"
  secondary: "#0E1020"
  tertiary: "#F43F75"
  on-tertiary: "#FFFFFF"
  neutral: "#F6F7FB"
  surface: "#FFFFFF"
  muted: "#6B7280"
  border: "#E6E8EF"
  success: "#16A34A"
  warning: "#D97706"
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
    fontWeight: 600
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
    backgroundColor: "#4338CA"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 20px
  chip-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.pill}"
---

## Overview

**Spotlight** — 舞台のスポットライトのように、その瞬間の主役（発表チーム・受賞者）を照らすデザイン。
ベースは静かでクリーンな余白の多いレイアウト。アクションと祝福の場面だけ、彩度の高い色とモーションで一気に高揚させる。「普段は冷静に運営、当日は熱く盛り上がる」を視覚で表現する。

落ち着いたインク色の見出し、クールなオフホワイトの背景、エレクトリックインディゴのアクション、そして表彰やお祝いに使う鮮やかなローズ。この4本柱で全画面の一貫性を保つ。

## Colors

ハイコントラストなニュートラルを土台に、操作色（インディゴ）と祝福色（ローズ）の2アクセントで構成する。

- **Primary (#4F46E5):** エレクトリックインディゴ。主要ボタン・リンク・選択状態など「操作」を一手に担う。
- **Secondary (#0E1020):** ほぼ黒のディープインク。見出し・本文の基調色。純黒は使わない。
- **Tertiary (#F43F75):** ビビッドローズ。表彰・お祝い・特別な強調にのみ使う祝福色。多用しない。
- **Neutral (#F6F7FB):** 少し青みのあるオフホワイト。アプリ全体の背景。純白の `surface` と重ねて階層を作る。
- **Surface (#FFFFFF):** カード等の前面。背景 neutral との差で奥行きを出す。
- **Muted (#6B7280):** スレートグレー。日時・補足・メタ情報。
- **Border (#E6E8EF):** 罫線・カード枠。影に頼らず境界を示す主役。

アクセント2色（primary / tertiary）を同一要素で同時に強く使わない。役割を「操作＝インディゴ／祝福＝ローズ」で分ける。

## Typography

書体は **Plus Jakarta Sans** に統一。幾何学的で親しみやすく、太いウェイトで力強い見出しが作れる。

- 見出しは太く（700–800）、字間をわずかに詰めて（-0.01〜-0.02em）密度と勢いを出す。
- 本文は行間 1.6 でゆったり。情報量が多い運営画面でも読みやすく。
- ラベル／チップは小さめ・太字・字間広め（+0.04em）で機能的に。
- フォントサイズの段階を増やしすぎない（display / h1 / h2 / body / label）。

## Layout

- コンテンツは中央寄せの単一カラムを基本（最大幅 ~960px）。イベント詳細など情報が多い画面のみ「本体＋右サイド（参加者など）」の2カラム。
- 余白はスケール（4/8/16/24/40px）に乗せる。隣接要素の間隔は迷ったら 16px。
- カードで情報をグルーピングし、背景 neutral とカード surface のコントラストで区切る。罫線（border）を細く効かせ、影は控えめに。

## Elevation & Depth

影は最小限。階層は「色（neutral 背景 vs surface 前面）＋ 細い border」で表現する。
例外は **表彰式の主役カード**と**モーダル**で、ここだけ強めの影（elevation 8 相当）と発色で前に出す。スポットライトの比喩どおり、強い奥行きは「主役の瞬間」に取っておく。

## Shapes

角丸は中庸（sm 10 / md 14 / lg 20px）。ボタンは丸み最大の pill 形で軽快さと押しやすさを出す。
正方形・鋭角は使わず、全体に柔らかく親しみのある印象を保つ。

## Components

- **button-primary:** インディゴ地・白文字・pill 形。ラベルは大文字化しない（日本語前提）。ホバーで一段濃いインディゴ。
- **card:** 白地・md 角丸・20px パディング・細い border。影は基本なし〜極薄。
- **chip-accent:** ローズ地・白文字・pill。「運営管理者」「表彰式」などの特別な状態バッジに。通常の状態（ロール等）はニュートラルなチップで控えめに。
- 入力・選択は MUI 標準の outlined を基調に、角丸と余白だけ本システムに合わせる。

## Do's and Don'ts

- **Do** 操作はインディゴ、祝福・受賞はローズ、と色の役割を一貫させる。
- **Do** 余白を恐れない。密度は罫線とカードで作り、色で詰め込まない。
- **Do** 見出しは太く短く。1画面に display 見出しは1つまで。
- **Don't** インディゴとローズを同じ要素で同時に強調しない。
- **Don't** 純黒（#000）・純白テキストの多用、影の多用をしない。階層は色と境界で。
- **Don't** 通常画面で派手なアニメーション・発色を使わない。演出は当日の進行（プレゼン／表彰）に集中させる。
