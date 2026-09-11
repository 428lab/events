import { batch, many, one } from "../client.js";
import type { ScheduleRegistrationResult } from "@eventer/shared";

// SQLite UUIDs let the whole voter set be handled in one transaction, not one
// Worker subrequest per person. IDs are data, never authorization tokens.
const uuid = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-8' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`;
const owned = `EXISTS (SELECT 1 FROM event_schedule_finalization WHERE event_id = ? AND token = ?)`;

export const scheduleRegistrationRepo = {
  async results(eventId: string): Promise<ScheduleRegistrationResult[]> {
    return many<ScheduleRegistrationResult>(
      `SELECT r.user_id AS userId,
      COALESCE(u.global_name,u.username) AS name, r.outcome,r.status,r.reason
      FROM event_schedule_registration r JOIN user u ON u.id=r.user_id AND u.deleted_at IS NULL
      WHERE r.event_id=? ORDER BY r.outcome,r.user_id`,
      eventId,
    );
  },
  async receipt(eventId: string) {
    return one<{ option_id: string }>(
      "SELECT option_id FROM event_schedule_finalization WHERE event_id=?",
      eventId,
    );
  },
  async finalize(
    eventId: string,
    optionId: string,
    actorId: string,
    dateMessage: string,
  ): Promise<boolean> {
    const token = crypto.randomUUID();
    const now = Date.now();
    // All guards are evaluated inside the same D1 transaction, including a
    // competing finalize, changed votes, cancellation, survey and slot capacity.
    const ready = `EXISTS (SELECT 1 FROM event e JOIN event_date_option o ON o.event_id=e.id
      WHERE e.id=? AND o.id=? AND e.scheduling=1
      AND (e.registration_deadline IS NULL OR e.registration_deadline<=o.starts_at))`;
    const changes = await batch([
      // An explicitly reopened poll starts a new receipt. A retry while finalized
      // keeps the old receipt and cannot re-register someone who later canceled.
      {
        sql: `DELETE FROM event_schedule_finalization WHERE event_id=? AND ${ready}`,
        args: [eventId, eventId, optionId],
      },
      {
        sql: `INSERT INTO event_schedule_finalization(event_id,option_id,token,created_at)
          SELECT ?,?,?,? WHERE ${ready} ON CONFLICT(event_id) DO NOTHING`,
        args: [eventId, optionId, token, now, eventId, optionId],
      },
      {
        sql: `INSERT INTO event_schedule_registration(event_id,user_id,outcome,status,reason,slot_id,member_id,entry_id)
        WITH base AS (
          SELECT v.user_id,v.created_at,m.status AS existing_status,
            (SELECT COUNT(*) FROM participation_slot WHERE event_id=e.id) AS slots,
            (SELECT id FROM participation_slot WHERE event_id=e.id ORDER BY id LIMIT 1) AS slot_id,
            CASE
              WHEN m.status IS NOT NULL AND m.status<>'canceled' THEN NULL
              WHEN m.status='canceled' THEN 'canceled'
              WHEN o.ends_at<? THEN 'event_ended'
              WHEN e.registration_deadline IS NOT NULL AND e.registration_deadline<=? THEN 'registration_closed'
              WHEN EXISTS (SELECT 1 FROM event_survey_question q LEFT JOIN event_survey_answer a
                ON a.question_id=q.id AND a.user_id=v.user_id
                WHERE q.event_id=e.id AND q.phase='pre' AND q.required=1
                AND (a.value IS NULL OR a.value='' OR a.value='[]')) THEN 'survey_required'
              WHEN (SELECT COUNT(*) FROM participation_slot WHERE event_id=e.id)>1 THEN 'slot_required'
              ELSE NULL END AS reason
          FROM event_date_vote v JOIN event_date_option o ON o.id=v.option_id
          JOIN event e ON e.id=o.event_id
          JOIN user u ON u.id=v.user_id AND u.deleted_at IS NULL
          LEFT JOIN event_member m ON m.event_id=e.id AND m.user_id=v.user_id
          WHERE e.id=? AND o.id=? AND v.choice IN ('yes','maybe') AND ${owned}
        ), ranked AS (
          SELECT *,ROW_NUMBER() OVER (PARTITION BY (reason IS NULL AND existing_status IS NULL)
            ORDER BY created_at,user_id) AS rank FROM base
        )
        SELECT ?,user_id,
          CASE WHEN reason IS NOT NULL THEN 'action_required' WHEN existing_status IS NOT NULL THEN 'existing' ELSE 'registered' END,
          CASE WHEN existing_status IS NOT NULL THEN existing_status WHEN reason IS NOT NULL THEN NULL
            WHEN slots=0 THEN 'confirmed'
            WHEN (SELECT selection_type FROM participation_slot WHERE id=ranked.slot_id)='lottery' THEN 'applied'
            WHEN rank <= (SELECT capacity FROM participation_slot WHERE id=ranked.slot_id) -
              (SELECT COUNT(*) FROM event_member WHERE slot_id=ranked.slot_id AND status='confirmed') THEN 'confirmed'
            ELSE 'waitlist' END,
          reason,slot_id,${uuid},${uuid} FROM ranked`,
        args: [now, now, eventId, optionId, eventId, token, eventId],
      },
      {
        sql: `INSERT INTO event_member(id,event_id,user_id,role,slot_id,status,created_at)
          SELECT r.member_id,r.event_id,r.user_id,'participant',r.slot_id,r.status,?
          FROM event_schedule_registration r JOIN event_date_vote v ON v.user_id=r.user_id AND v.option_id=?
          WHERE r.event_id=? AND r.outcome='registered' AND ${owned}
          ORDER BY v.created_at,r.user_id`,
        // Preserve response order in insertion order. Promotion uses rowid as
        // the stable tie-break for equal millisecond registration timestamps.
        args: [now, optionId, eventId, eventId, token],
      },
      {
        sql: `INSERT INTO entry(id,event_id,kind,name,created_at)
          SELECT r.entry_id,r.event_id,'individual',COALESCE(u.global_name,u.username),?
          FROM event_schedule_registration r JOIN user u ON u.id=r.user_id
          WHERE r.event_id=? AND r.outcome='registered' AND r.status='confirmed' AND ${owned}
          AND NOT EXISTS(SELECT 1 FROM entry x JOIN entry_member em ON em.entry_id=x.id
            WHERE x.event_id=r.event_id AND x.kind='individual' AND em.user_id=r.user_id)`,
        args: [now, eventId, eventId, token],
      },
      {
        sql: `INSERT INTO entry_member(id,entry_id,user_id,is_leader)
          SELECT ${uuid},r.entry_id,r.user_id,1 FROM event_schedule_registration r JOIN entry x ON x.id=r.entry_id
          WHERE r.event_id=? AND r.outcome='registered' AND ${owned}`,
        args: [eventId, eventId, token],
      },
      {
        sql: `INSERT INTO notification(id,user_id,type,title,body,link,read_at,created_at)
          SELECT ${uuid},v.user_id,'schedule_finalized','日程が確定しました',? ||
          CASE WHEN r.outcome='registered' THEN CASE r.status
            WHEN 'confirmed' THEN '。○・△の回答に基づいて参加登録しました。変更する場合はイベントページから参加を取り消せます。'
            WHEN 'waitlist' THEN '。満員のためキャンセル待ちとして登録しました。'
            ELSE '。抽選申込として登録しました。参加確定ではありません。' END
          WHEN r.outcome='action_required' THEN CASE r.reason
            WHEN 'canceled' THEN '。以前の参加取消を維持しました。参加する場合は再登録してください。'
            WHEN 'survey_required' THEN '。参加登録には必須アンケートへの回答が必要です。'
            WHEN 'slot_required' THEN '。参加登録には参加枠の選択が必要です。'
            WHEN 'event_ended' THEN '。終了済みのため参加登録していません。必要な場合は主催者に確認してください。'
            ELSE '。募集締切後のため参加登録していません。必要な場合は主催者に確認してください。' END
          ELSE '' END,?,0,?
          FROM (SELECT DISTINCT v.user_id FROM event_date_vote v JOIN event_date_option o ON o.id=v.option_id
            JOIN user u ON u.id=v.user_id AND u.deleted_at IS NULL WHERE o.event_id=?) v
          LEFT JOIN event_schedule_registration r ON r.event_id=? AND r.user_id=v.user_id
          WHERE (v.user_id<>? OR r.outcome IN ('registered','action_required')) AND ${owned}`,
        args: [
          dateMessage,
          `/events/${eventId}`,
          now,
          eventId,
          eventId,
          actorId,
          eventId,
          token,
        ],
      },
      {
        sql: `UPDATE event SET starts_at=(SELECT starts_at FROM event_date_option WHERE id=?),
          ends_at=(SELECT ends_at FROM event_date_option WHERE id=?),scheduling=0 WHERE id=? AND ${owned}`,
        args: [optionId, optionId, eventId, eventId, token],
      },
    ]);
    return changes[1] > 0;
  },
};
