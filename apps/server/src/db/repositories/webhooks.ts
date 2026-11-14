import type { WebhookKind, WebhookTopic, WebhookView } from "@eventer/shared";
import { WEBHOOK_MAX_CONSECUTIVE_FAILURES } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/** コミュニティ・イベントごとの Discord / Slack 通知の保存と宛先の解決 (docs/webhooks.md)。
 * URL（トークン）は画面へ返さない。`toView` は種類・ホスト・末尾4文字だけを出す */

interface WebhookRow {
  id: string;
  scope: "community" | "event";
  community_id: string | null;
  event_id: string | null;
  kind: WebhookKind;
  url: string;
  label: string;
  notify_inquiry: number;
  notify_join: number;
  notify_cancel: number;
  active: number;
  fail_count: number;
  last_error: string | null;
  last_failed_at: number | null;
  last_sent_at: number | null;
  created_at: number;
}

export type WebhookScope = { community: string } | { event: string };

export interface WebhookTarget {
  id: string;
  kind: WebhookKind;
  url: string;
}

function urlHint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname} …${url.replace(/\/+$/, "").slice(-4)}`;
  } catch {
    return "…";
  }
}

function toView(r: WebhookRow): WebhookView {
  return {
    id: r.id,
    kind: r.kind,
    urlHint: urlHint(r.url),
    label: r.label,
    notifyInquiry: r.notify_inquiry === 1,
    notifyJoin: r.notify_join === 1,
    notifyCancel: r.notify_cancel === 1,
    active: r.active === 1,
    failCount: r.fail_count,
    lastError: r.last_error,
    lastSentAt: r.last_sent_at,
    createdAt: r.created_at,
  };
}

const scopeWhere = (s: WebhookScope) =>
  "community" in s ? { sql: "scope = 'community' AND community_id = ?", arg: s.community } : { sql: "scope = 'event' AND event_id = ?", arg: s.event };

const TOPIC_COLUMN: Record<WebhookTopic, string> = {
  inquiry: "notify_inquiry",
  join: "notify_join",
  cancel: "notify_cancel",
};

export const webhooksRepo = {
  async list(scope: WebhookScope): Promise<WebhookView[]> {
    const w = scopeWhere(scope);
    const rows = await many<WebhookRow>(`SELECT * FROM webhook WHERE ${w.sql} ORDER BY created_at ASC`, w.arg);
    return rows.map(toView);
  },

  async count(scope: WebhookScope): Promise<number> {
    const w = scopeWhere(scope);
    const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM webhook WHERE ${w.sql}`, w.arg);
    return r?.n ?? 0;
  },

  async create(
    scope: WebhookScope,
    input: { kind: WebhookKind; url: string; label: string; notifyInquiry: boolean; notifyJoin: boolean; notifyCancel: boolean },
    createdBy: string,
  ): Promise<WebhookView> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO webhook (id, scope, community_id, event_id, kind, url, label, notify_inquiry, notify_join, notify_cancel, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      "community" in scope ? "community" : "event",
      "community" in scope ? scope.community : null,
      "event" in scope ? scope.event : null,
      input.kind,
      input.url.trim(),
      input.label,
      input.notifyInquiry ? 1 : 0,
      input.notifyJoin ? 1 : 0,
      input.notifyCancel ? 1 : 0,
      createdBy,
      Date.now(),
    );
    const row = await one<WebhookRow>("SELECT * FROM webhook WHERE id = ?", id);
    return toView(row!);
  },

  /** その単位（コミュニティ／イベント）に属する Webhook だけを触る。見つからなければ null */
  async findInScope(scope: WebhookScope, id: string): Promise<WebhookRow | null> {
    const w = scopeWhere(scope);
    return one<WebhookRow>(`SELECT * FROM webhook WHERE id = ? AND ${w.sql}`, id, w.arg);
  },

  async update(
    scope: WebhookScope,
    id: string,
    patch: { label?: string; notifyInquiry?: boolean; notifyJoin?: boolean; notifyCancel?: boolean; active?: boolean },
  ): Promise<WebhookView | null> {
    const w = scopeWhere(scope);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.label !== undefined) { sets.push("label = ?"); args.push(patch.label); }
    if (patch.notifyInquiry !== undefined) { sets.push("notify_inquiry = ?"); args.push(patch.notifyInquiry ? 1 : 0); }
    if (patch.notifyJoin !== undefined) { sets.push("notify_join = ?"); args.push(patch.notifyJoin ? 1 : 0); }
    if (patch.notifyCancel !== undefined) { sets.push("notify_cancel = ?"); args.push(patch.notifyCancel ? 1 : 0); }
    if (patch.active !== undefined) {
      sets.push("active = ?");
      args.push(patch.active ? 1 : 0);
      // 再開するときは失敗の数え直し（止まった理由は次の送信で上書きされる）
      if (patch.active) sets.push("fail_count = 0");
    }
    if (sets.length > 0) {
      await run(`UPDATE webhook SET ${sets.join(", ")} WHERE id = ? AND ${w.sql}`, ...args, id, w.arg);
    }
    const row = await this.findInScope(scope, id);
    return row ? toView(row) : null;
  },

  async remove(scope: WebhookScope, id: string): Promise<boolean> {
    const w = scopeWhere(scope);
    return (await runCount(`DELETE FROM webhook WHERE id = ? AND ${w.sql}`, id, w.arg)) > 0;
  },

  /** イベントで起きたことを送る先。イベントの Webhook と、**主催**コミュニティの Webhook のうち、
   * その種類がオンで有効なもの。共催先コミュニティの Webhook には送らない（オーナー決定 2026-11-14:
   * 共催の運営と同じチャンネルで見るときは、そのイベントに Webhook を登録する）。
   * 同じ URL は1回だけ（登録が重なっていても二重に送らない） */
  async targetsForEvent(eventId: string, topic: WebhookTopic): Promise<WebhookTarget[]> {
    const col = TOPIC_COLUMN[topic];
    const rows = await many<WebhookTarget>(
      `SELECT w.id, w.kind, w.url FROM webhook w
        WHERE w.active = 1 AND w.${col} = 1
          AND ((w.scope = 'event' AND w.event_id = ?)
            OR (w.scope = 'community' AND w.community_id = (SELECT e.community_id FROM event e WHERE e.id = ?)))
        ORDER BY w.created_at ASC`,
      eventId,
      eventId,
    );
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = r.url.trim().replace(/\/+$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async findById(id: string): Promise<WebhookTarget | null> {
    return one<WebhookTarget>("SELECT id, kind, url FROM webhook WHERE id = ?", id);
  },

  /** 送れたら失敗の数を 0 に戻す */
  async recordSuccess(id: string): Promise<void> {
    await run("UPDATE webhook SET fail_count = 0, last_error = NULL, last_failed_at = NULL, last_sent_at = ? WHERE id = ?", Date.now(), id);
  },

  /** 失敗を記録する。止めるかどうかを数えるのは、送り直しても直らない失敗（permanent）だけ。
   * 続けて WEBHOOK_MAX_CONSECUTIVE_FAILURES 回そうなったら自動で止める。
   * 一時的な失敗（429・5xx・通信エラー）は last_error / last_failed_at に残すだけで数えない:
   * 参加と取消を繰り返して 429 を起こさせる・相手側の短い障害だけで、通知を止められないようにする */
  async recordFailure(id: string, error: string, permanent: boolean): Promise<void> {
    await run(
      `UPDATE webhook SET last_error = ?, last_failed_at = ?,
          fail_count = fail_count + ?,
          active = CASE WHEN ? = 1 AND fail_count + 1 >= ? THEN 0 ELSE active END
        WHERE id = ?`,
      error.slice(0, 200),
      Date.now(),
      permanent ? 1 : 0,
      permanent ? 1 : 0,
      WEBHOOK_MAX_CONSECUTIVE_FAILURES,
      id,
    );
  },
};
