import type { ProfileDeck } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/**
 * プロフィールの「スライド」タブ（docs/profile-tabs.md「スライド」・docs/slide-editor.md「プロフィールに載せる」）。
 *
 * 載せられるデッキ（eligible）:
 * - 自分の個人のデッキ
 * - 自分がいまメンバーのチームのスライドのうち、イベントが公開（public・公開済み）のもの。
 *   限定公開・招待限定のイベントのチーム名やイベント名をプロフィールから出さないため
 *
 * 載っている（shown）= 載せられる かつ（本人が「載せる」にした または
 * （「自動で載せる」がオン かつ 本人が「載せない」にしていない））。
 * 一覧・スイッチの状態・載せる操作の判定はすべてこの2つの SQL を通す。
 * `d` はデッキ表の別名、`u` はユーザーIDの式（列か `?`）。
 */
export function deckEligibleOnProfileSql(d: string, u: string): string {
  return `((${d}.team_entry_id IS NULL AND ${d}.owner_id = ${u})
    OR (${d}.team_entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM entry_member pe_member
      JOIN entry pe_entry ON pe_entry.id = pe_member.entry_id AND pe_entry.kind = 'team'
      JOIN event pe_event ON pe_event.id = pe_entry.event_id
        AND pe_event.status = 'published' AND pe_event.visibility = 'public'
      WHERE pe_member.entry_id = ${d}.team_entry_id AND pe_member.user_id = ${u})))`;
}

export function deckShownOnProfileSql(d: string, u: string): string {
  return `(${deckEligibleOnProfileSql(d, u)} AND (
    EXISTS (SELECT 1 FROM profile_deck ps_on WHERE ps_on.user_id = ${u} AND ps_on.deck_id = ${d}.id AND ps_on.show = 1)
    OR (EXISTS (SELECT 1 FROM profile_setting ps_auto WHERE ps_auto.user_id = ${u} AND ps_auto.auto_show_decks = 1)
      AND NOT EXISTS (SELECT 1 FROM profile_deck ps_off WHERE ps_off.user_id = ${u} AND ps_off.deck_id = ${d}.id AND ps_off.show = 0))))`;
}

/** 表示回数（日ごとのユニーク訪問者の合計）。`d` はデッキ表の別名 */
export const deckViewsSql = (d: string) =>
  `(SELECT COUNT(*) FROM deck_view_unique dv WHERE dv.deck_id = ${d}.id)`;

interface ProfileDeckRow {
  slug: string;
  title: string;
  content: string;
  updated_at: number;
  views: number;
  team_name: string | null;
  event_title: string | null;
}

export const profileDecksRepo = {
  /** 公開プロフィールに載っているデッキ。新しい順。サムネ用に1枚目だけ返す。
   * 先に本人のデッキ・本人がメンバーのチームのデッキへ絞る（索引が効く）。
   * 絞らないと公開の一覧を見るたびにデッキ表を全件読む */
  async listShown(userId: string): Promise<ProfileDeck[]> {
    const rows = await many<ProfileDeckRow>(
      `SELECT d.slug, d.title, d.content, d.updated_at, ${deckViewsSql("d")} AS views,
              en.name AS team_name, ev.title AS event_title
         FROM deck d, (SELECT ? AS id) pu
         LEFT JOIN entry en ON en.id = d.team_entry_id
         LEFT JOIN event ev ON ev.id = en.event_id
        WHERE (d.owner_id = pu.id
               OR d.team_entry_id IN (SELECT cand.entry_id FROM entry_member cand WHERE cand.user_id = pu.id))
          AND ${deckShownOnProfileSql("d", "pu.id")}
        ORDER BY d.updated_at DESC
        LIMIT 200`,
      userId,
    );
    return rows.map((r) => {
      let slides: ProfileDeck["firstSlide"][] = [];
      try {
        const parsed = JSON.parse(r.content);
        if (parsed && Array.isArray(parsed.slides)) slides = parsed.slides;
      } catch {
        /* 壊れた本文は空として扱う */
      }
      return {
        slug: r.slug,
        title: r.title,
        firstSlide: slides[0] ?? null,
        slideCount: slides.length,
        views: r.views,
        updatedAt: r.updated_at,
        team: r.team_name !== null ? { name: r.team_name, eventTitle: r.event_title ?? "" } : null,
      };
    });
  },

  /** 「載せる／載せない」を本人の選択として書く。載せられないデッキなら false（書かない） */
  async setShown(userId: string, deckId: string, show: boolean): Promise<boolean> {
    return (await runCount(
      `INSERT INTO profile_deck (user_id, deck_id, show, updated_at)
       SELECT ?, d.id, ?, ? FROM deck d, (SELECT ? AS id) pu
        WHERE d.id = ? AND ${deckEligibleOnProfileSql("d", "pu.id")}
       ON CONFLICT(user_id, deck_id) DO UPDATE SET show = excluded.show, updated_at = excluded.updated_at`,
      userId, show ? 1 : 0, Date.now(), userId, deckId,
    )) > 0;
  },

  async autoShow(userId: string): Promise<boolean> {
    return (await one<{ v: number }>(
      "SELECT auto_show_decks AS v FROM profile_setting WHERE user_id = ?", userId,
    ))?.v === 1;
  },

  async setAutoShow(userId: string, on: boolean): Promise<void> {
    await run(
      `INSERT INTO profile_setting (user_id, auto_show_decks, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET auto_show_decks = excluded.auto_show_decks, updated_at = excluded.updated_at`,
      userId, on ? 1 : 0, Date.now(),
    );
  },

  /** 公開ビューアの表示を1回数える（同じ訪問者は1日1回）。持ち主・チームのメンバーの閲覧は数えない */
  async recordView(slug: string, day: string, visitorId: string, viewerId: string | null): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO deck_view_unique (deck_id, day, visitor_id)
       SELECT d.id, ?, ? FROM deck d
        WHERE d.slug = ?
          AND NOT (? IS NOT NULL AND (d.owner_id = ? OR EXISTS (SELECT 1 FROM entry_member vm
            WHERE vm.entry_id = d.team_entry_id AND vm.user_id = ?)))`,
      day, visitorId, slug, viewerId, viewerId, viewerId,
    );
  },

  async viewsBySlug(slug: string): Promise<number> {
    return (await one<{ v: number }>(
      "SELECT COUNT(*) AS v FROM deck_view_unique dv JOIN deck d ON d.id = dv.deck_id WHERE d.slug = ?", slug,
    ))?.v ?? 0;
  },
};
