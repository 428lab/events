/** プロフィールをカード1枚分の値に畳む (#178)。
 *
 * ここには絵が1つも無い。公開プロフィールAPI（と名札一括印刷の軽量ペイロード）から、
 * カードに刷る値だけを取り出して並べ替える純粋な変換。
 * 描画 (`LicenseCardSvg.tsx`) と同居していたが、読む人・直す人が別なので分けた (#466)。 */
import { BADGE_DEFS } from "@eventer/shared";

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
