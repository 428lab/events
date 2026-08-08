import type { Notification, NotificationType } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";
import { deferBackground } from "../../runtime.js";
import {
  sendNotificationEmailIfOptedIn,
  sendNotificationEmailTo,
  type EmailExtras,
} from "../../lib/email.js";
import { emailRepo } from "./email.js";

/** createForMany 1回あたりのメール送信上限（サブリクエスト数の安全上限） */
const MAX_BULK_EMAILS = 50;

/**
 * createForMany の途中で失敗したことを、そこまでに作れた人数つきで伝える。
 *
 * 一括作成は先頭から順に固まりで書くので、delivered 人目までは通知が作られている
 * ＝ userIds の先頭 delivered 人には届いている。呼び出し元がこれを見て
 * 「一部にだけ届いた」ことを記録できるようにする（黙って全体を失敗にすると、
 * 再送を促されて同じ人に二重に届く）。
 */
export class PartialNotificationError extends Error {
  constructor(
    readonly delivered: number,
    override readonly cause: unknown,
  ) {
    super(`notification: 一括作成が途中で失敗しました（${delivered} 人まで作成）`);
    this.name = "PartialNotificationError";
  }
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: number;
  created_at: number;
}

function toNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.read_at > 0,
    createdAt: r.created_at,
  };
}

export const notificationsRepo = {
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body = "",
    link = "",
    // メール表示のみに使う付加情報 (#134)。DB スキーマは変えない
    extras?: EmailExtras,
  ): Promise<void> {
    await run(
      `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      crypto.randomUUID(),
      userId,
      type,
      title,
      body,
      link,
      Date.now(),
    );
    // メール通知ONのユーザーには同内容をメールでも送る (#126)。
    // レスポンスをブロックしないよう waitUntil に逃がす（失敗しても通知作成は成功扱い）
    await deferBackground(
      sendNotificationEmailIfOptedIn(userId, title, body, link, extras),
    );
  },

  /** 複数ユーザーへ同一内容の通知を作成（抽選・表彰・フォロワー通知の一斉配信用）。
   * 1人1クエリだとサブリクエスト上限とレイテンシに響くため、D1 batch でまとめて挿入 */
  async createForMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body = "",
    link = "",
    // メール表示のみに使う付加情報 (#134)。DB スキーマは変えない
    extras?: EmailExtras,
    // メール配信をここでは行わない。一斉連絡 (#172) のように、送信待ちを積んで
    // 定期実行で順次送る＝配信を自前で持っている呼び出し元のためのもの。
    // ここに任せると上限 (MAX_BULK_EMAILS) で静かに打ち切られ、
    // 「誰に届いていないか」も残らない
    opts?: { skipEmail?: boolean },
  ): Promise<void> {
    const now = Date.now();
    const CHUNK = 50;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK);
      try {
        await batch(
          chunk.map((userId) => ({
            sql: `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            args: [crypto.randomUUID(), userId, type, title, body, link, now],
          })),
        );
      } catch (e) {
        // どこまで作れたかを添えて投げ直す（呼び出し元が「一部にだけ届いた」と扱えるように）
        throw new PartialNotificationError(i, e);
      }
    }
    if (opts?.skipEmail) return;
    // メール通知ONのユーザーへも配信 (#126)。上限つき・waitUntil でレスポンス外に逃がす
    await deferBackground(
      (async () => {
        try {
          const recipients = await emailRepo.findRecipientsAmong(userIds);
          if (recipients.length > MAX_BULK_EMAILS) {
            console.warn(
              `email: 一斉通知のメール対象 ${recipients.length} 件中 ${MAX_BULK_EMAILS} 件のみ送信`,
            );
          }
          for (const r of recipients.slice(0, MAX_BULK_EMAILS)) {
            await sendNotificationEmailTo(
              r.userId,
              r.email,
              title,
              body,
              link,
              extras,
            );
          }
        } catch (e) {
          console.warn("email: 一斉通知のメール送信に失敗", e);
        }
      })(),
    );
  },

  /** 退会申請 (#250) したユーザーが「した側」として生成した通知を削除する。
   *
   * follow 起点の通知と meet 通知はタイトルに「◯◯ さんが…」と表示名を焼き込んで
   * いるため、行が残っているとフォロワー／同席者の通知一覧に名前が出続ける
   * （#244 の完全削除でも notification.user_id は受信者なので消えない）。
   * notification テーブルには actor 列が無いので、種別ごとに actor を特定できる
   * 条件で消す:
   *   - meet                    : link が actor 本人のプロフィールURL
   *   - followee_created_event  : link 先のイベントの created_by が actor
   *   - followee_joined_event   : actor が参加しているイベント かつ タイトルが
   *                               actor の表示名で始まる（同じイベントに参加した
   *                               別のフォロイーの通知を巻き込まないため）
   *
   * 復帰しても通知は戻らない。通知は流れていく性質のもので、履歴として復元する
   * 価値より猶予期間中に名前が見え続ける不利益のほうが大きいと判断した。
   * D1 batch なのでサブリクエストは1つ。 */
  async deleteByActor(actor: {
    id: string;
    username: string;
    globalName: string | null;
  }): Promise<void> {
    // LIKE のワイルドカード (% _) を含む表示名で広く消しすぎないようエスケープ
    const likePrefix = (name: string) =>
      `${name.replace(/[\\%_]/g, (c) => `\\${c}`)} さんが%`;
    const names = [actor.globalName, actor.username].filter(
      (n): n is string => !!n,
    );
    await batch([
      {
        sql: "DELETE FROM notification WHERE type = 'meet' AND link = ?",
        args: [`/users/${encodeURIComponent(actor.username)}`],
      },
      {
        sql: `DELETE FROM notification WHERE type = 'followee_created_event'
                AND link IN (SELECT '/events/' || id FROM event WHERE created_by = ?)`,
        args: [actor.id],
      },
      {
        sql: `DELETE FROM notification WHERE type = 'followee_joined_event'
                AND (${names.map(() => "title LIKE ? ESCAPE '\\'").join(" OR ")})
                AND link IN (SELECT '/events/' || event_id FROM event_member WHERE user_id = ?)`,
        args: [...names.map(likePrefix), actor.id],
      },
    ]);
  },

  /** 受信者本人のぶんを新しい順に。user_id で必ず絞るので、他人の通知は出ない。
   * created_at が同じ行（一斉連絡は全員同じ時刻で作る）でも順序がぶれないよう
   * id を第2キーにする。ぶれるとページの境目で取りこぼし・重複が起きる */
  async listByUser(
    userId: string,
    limit = 40,
    offset = 0,
  ): Promise<Notification[]> {
    const rows = await many<NotificationRow>(
      "SELECT * FROM notification WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      userId,
      limit,
      offset,
    );
    return rows.map(toNotification);
  },

  /** 本人の通知の総数（一覧のページ数計算用） */
  async countByUser(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ?",
      userId,
    );
    return row?.n ?? 0;
  },

  async unreadCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ? AND read_at = 0",
      userId,
    );
    return row?.n ?? 0;
  },

  async markRead(id: string, userId: string): Promise<void> {
    await run(
      "UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ? AND read_at = 0",
      Date.now(),
      id,
      userId,
    );
  },

  async markAllRead(userId: string): Promise<void> {
    await run(
      "UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at = 0",
      Date.now(),
      userId,
    );
  },
};
