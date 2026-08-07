import type { EventQuestion } from "@eventer/shared";
import { many, one, run, runCount } from "../client.js";

/** 一覧の1行（投稿者・票数・自分の投票つき）。表示上の出し分け（匿名の author 落とし）は
 * ルート側で行う。ここでは「実データ」をそのまま返す */
export interface QuestionRow {
  id: string;
  event_id: string;
  user_id: string;
  body: string;
  anonymous: number;
  answered: number;
  hidden: number;
  created_at: number;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  votes: number;
  voted: number;
}

/** 投稿者は「退会申請中 (#250) でない」ユーザーのみ。
 * event_comment と同じく、退会申請中ユーザーの投稿は一覧から落とす。
 * 票も同様に退会申請中ユーザー分は数えない（一覧に並ぶ人数と票数がズレないように） */
const SELECT_QUESTION = `SELECT q.id, q.event_id, q.user_id, q.body, q.anonymous,
    q.answered, q.hidden, q.created_at,
    u.username, u.global_name, u.avatar_url,
    (SELECT COUNT(1) FROM event_question_vote v
       JOIN user vu ON vu.id = v.user_id AND vu.deleted_at IS NULL
      WHERE v.question_id = q.id) AS votes,
    (SELECT COUNT(1) FROM event_question_vote v2
      WHERE v2.question_id = q.id AND v2.user_id = ?) AS voted
  FROM event_question q
  JOIN user u ON u.id = q.user_id AND u.deleted_at IS NULL`;

/** 並び: 未回答が先 → 票数の多い順 → 古い順（先に聞いた人が上）→ id。
 * 最後に id を入れているのは、票数も投稿時刻も同じときに並びが揺れないようにするため
 * （2秒おきに再取得するので、順序が安定しないと行が跳ねて見える） */
const ORDER_QUESTION =
  "ORDER BY q.answered ASC, votes DESC, q.created_at ASC, q.id ASC";

export const eventQaRepo = {
  /** イベントの質問一覧。hidden は includeHidden（staff）のときだけ含む */
  async listByEvent(
    eventId: string,
    viewerId: string,
    includeHidden: boolean,
  ): Promise<QuestionRow[]> {
    return many<QuestionRow>(
      `${SELECT_QUESTION} WHERE q.event_id = ?${
        includeHidden ? "" : " AND q.hidden = 0"
      } ${ORDER_QUESTION}`,
      viewerId,
      eventId,
    );
  },

  async findById(id: string, viewerId: string): Promise<QuestionRow | null> {
    return one<QuestionRow>(`${SELECT_QUESTION} WHERE q.id = ?`, viewerId, id);
  },

  /** そのイベントの質問かどうか（他イベントのIDを差し込まれないように使う） */
  async belongsTo(id: string, eventId: string): Promise<boolean> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_question WHERE id = ? AND event_id = ?",
      id,
      eventId,
    );
    return (row?.n ?? 0) > 0;
  },

  async create(
    eventId: string,
    userId: string,
    body: string,
    anonymous: boolean,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_question
        (id, event_id, user_id, body, anonymous, answered, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      id,
      eventId,
      userId,
      body,
      anonymous ? 1 : 0,
      Date.now(),
    );
    return id;
  },

  /** 投票（冪等。二重投票は主キーで弾かれる） */
  async vote(questionId: string, userId: string): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO event_question_vote (question_id, user_id, created_at)
       VALUES (?, ?, ?)`,
      questionId,
      userId,
      Date.now(),
    );
  },

  /** 投票の取り消し（冪等） */
  async unvote(questionId: string, userId: string): Promise<void> {
    await run(
      "DELETE FROM event_question_vote WHERE question_id = ? AND user_id = ?",
      questionId,
      userId,
    );
  },

  /** 回答済み / 非表示の更新（staff）。渡された項目だけ変える */
  async updateFlags(
    questionId: string,
    flags: { answered?: boolean; hidden?: boolean },
  ): Promise<void> {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (flags.answered !== undefined) {
      sets.push("answered = ?");
      args.push(flags.answered ? 1 : 0);
    }
    if (flags.hidden !== undefined) {
      sets.push("hidden = ?");
      args.push(flags.hidden ? 1 : 0);
    }
    if (sets.length === 0) return;
    await run(
      `UPDATE event_question SET ${sets.join(", ")} WHERE id = ?`,
      ...args,
      questionId,
    );
  },

  /** 「いまこの質問」。1件だけという制約は event の1列で表している */
  async pickedFor(eventId: string): Promise<string | null> {
    const row = await one<{ qa_picked_question_id: string | null }>(
      "SELECT qa_picked_question_id FROM event WHERE id = ?",
      eventId,
    );
    return row?.qa_picked_question_id ?? null;
  },

  async setPicked(eventId: string, questionId: string | null): Promise<void> {
    await run(
      "UPDATE event SET qa_picked_question_id = ? WHERE id = ?",
      questionId,
      eventId,
    );
  },

  /** その質問がピックアップ中なら解除する（非表示にしたときの後始末） */
  async clearPickedIf(eventId: string, questionId: string): Promise<number> {
    return runCount(
      "UPDATE event SET qa_picked_question_id = NULL WHERE id = ? AND qa_picked_question_id = ?",
      eventId,
      questionId,
    );
  },
};

/** DB の行を API レスポンスの形にする。
 * anonymous な質問の投稿者は showAuthor（staff）のときだけ入れる。
 * **匿名投稿でも user_id は必ず記録されている**ので、ここで落とすのは表示だけ */
export function toQuestion(
  row: QuestionRow,
  viewerId: string,
  showAuthor: boolean,
): EventQuestion {
  const anonymous = row.anonymous === 1;
  return {
    id: row.id,
    eventId: row.event_id,
    body: row.body,
    createdAt: row.created_at,
    anonymous,
    answered: row.answered === 1,
    hidden: row.hidden === 1,
    votes: row.votes,
    votedByMe: row.voted > 0,
    mine: row.user_id === viewerId,
    author:
      anonymous && !showAuthor
        ? null
        : {
            id: row.user_id,
            username: row.username,
            name: row.global_name ?? row.username,
            avatarUrl: row.avatar_url,
          },
  };
}
