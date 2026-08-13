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

/** 退会申請 (#250) で消す通知の種別 (#380)。
 *
 * 「退会する本人の名前が、他の利用者の通知一覧に出続けてしまう」ものだけを挙げる。
 * actor_id を埋めている種別と**わざと一致させていない**。埋めるのは
 * 「文面に名前が出る通知すべて」で、消すのはそのうち退会で消すと決めたものだけ。
 * 分けておかないと、actor_id を埋める範囲を広げた瞬間に削除範囲も黙って広がる。 */
const ACTOR_ERASED_TYPES = [
  "meet",
  "followee_created_event",
  "followee_joined_event",
] as const satisfies readonly NotificationType[];

export const notificationsRepo = {
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body = "",
    link = "",
    // メール表示のみに使う付加情報 (#134)。DB スキーマは変えない
    extras?: EmailExtras,
    // その通知の主語になっている利用者 (#380)。主語が人でないときは渡さない
    opts?: { actorId?: string },
  ): Promise<void> {
    await run(
      `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      crypto.randomUUID(),
      userId,
      type,
      title,
      body,
      link,
      Date.now(),
      opts?.actorId ?? null,
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
    // actorId: その通知の主語になっている利用者 (#380)。主語が人でないときは渡さない
    opts?: { skipEmail?: boolean; actorId?: string },
  ): Promise<void> {
    const now = Date.now();
    const CHUNK = 50;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK);
      try {
        await batch(
          chunk.map((userId) => ({
            sql: `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at, actor_id)
                  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            args: [
              crypto.randomUUID(),
              userId,
              type,
              title,
              body,
              link,
              now,
              opts?.actorId ?? null,
            ],
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
   * 判定は actor_id 一本 (#380)。以前は種別ごとに link / title から actor を
   * 推定していたが、
   *   - title の綴りに依存する＝通知の文言を変えた時点で消えなくなる
   *   - link / title は「現在の username・表示名」なので、改名した人を取りこぼす
   *   - 同姓同名が同席していると別人の通知まで消す
   * のいずれでも破れていた。actor_id ならどれも起きない。
   *
   * 復帰しても通知は戻らない（従来どおり）。 */
  async deleteByActor(actorId: string): Promise<void> {
    await run(
      `DELETE FROM notification
        WHERE actor_id = ?
          AND type IN (${ACTOR_ERASED_TYPES.map(() => "?").join(", ")})`,
      actorId,
      ...ACTOR_ERASED_TYPES,
    );
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

  /** 出会いの取り消し (#330) に伴って、その読み取りで出した meet 通知を消す。
   *
   * notification は出会いの行を参照していないので、「誰から (actor_id=読み取った側)
   * いつ以降に届いた meet 通知か」で絞る (#380)。since には取り消しトークンの発行時刻を
   * 渡す想定で、それより前の（別の機会の）通知には触らない。
   * メールは送信済みなら取り消せないが、通知一覧に残り続けるのは防げる。 */
  async deleteMeetSince(
    userId: string,
    actorId: string,
    since: number,
  ): Promise<void> {
    await run(
      `DELETE FROM notification
        WHERE user_id = ? AND type = 'meet' AND actor_id = ? AND created_at >= ?`,
      userId,
      actorId,
      since,
    );
  },
};
