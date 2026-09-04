import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Chip, Stack } from "@mui/material";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { Link as RouterLink } from "react-router-dom";
import type { Event, EventRole } from "@eventer/shared";
import {
  useEventMembers,
  useEventSlots,
  useJoinEvent,
  useLeaveEvent,
  useMe,
} from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useEventSurvey } from "../api/eventSurveyHooks.js";
import { ApiError } from "../api/client.js";
import { participationStatusLabel } from "../lib/format.js";
import type { EventTiming } from "../lib/useEventTiming.js";
import { EventSlots } from "./EventSlots.js";
import { EntranceQrDialog } from "./EntranceQrDialog.js";
import { SurveyAnswerDialog } from "./SurveyAnswerDialog.js";

/**
 * 参加者としての自分の行動をまとめたブロック。
 *
 * 参加状態のバッジ、入場QR (#154)、事前アンケート (#152) を挟む参加操作、
 * 断られた理由の表示 (#269)、採点への導線、参加枠の一覧まで。
 * 参加の入口が2つ（下のボタンと参加枠のボタン）あるので、アンケートを挟む
 * 判断とエラー処理を1か所に置くためにこの単位で切り出してある。
 */
export function EventJoinPanel({
  eventId,
  event,
  myRole,
  contest,
  timing,
}: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  contest: boolean;
  timing: EventTiming;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: members } = useEventMembers(eventId, true);
  const { data: slots } = useEventSlots(eventId);
  const { data: state } = useEventState(eventId, Boolean(me));
  // 事前アンケート (#152)。質問があれば参加前に回答ダイアログを挟む
  const { data: surveyQuestions } = useEventSurvey(eventId);
  const join = useJoinEvent();
  const leave = useLeaveEvent();

  const [surveyOpen, setSurveyOpen] = useState(false);
  // 回答後に続行する参加操作（null = 参加ではなく回答の編集）
  const [pendingJoin, setPendingJoin] = useState<{ slotId?: string } | null>(
    null,
  );
  // 入場QR（受付チェックイン用チケット） (#154)
  const [entranceQrOpen, setEntranceQrOpen] = useState(false);
  // 参加できなかった理由の表示（締切/終了）。押しても何も起きない状態を作らない (#269)
  const [joinError, setJoinError] = useState("");

  const isMember = Boolean(myRole);
  const myMembership = members?.find((m) => me && m.user.id === me.id);
  const hasSurvey = (surveyQuestions?.length ?? 0) > 0;
  const hasSlots = Boolean(slots && slots.length > 0);
  const { ended, registrationClosed } = timing;

  const doJoin = (slotId?: string) =>
    join.mutate(
      { id: eventId, ...(slotId ? { slotId } : {}) },
      {
        onSuccess: () => setJoinError(""),
        onError: (err) => {
          const code =
            err instanceof ApiError
              ? (err.body as { error?: string } | null)?.error
              : undefined;
          // サーバー側の必須アンケート未回答 (409 survey_required) はダイアログで回答してもらう
          if (code === "survey_required") {
            // ページ読込後に質問が追加されたケースに備え、最新の質問を取得してから開く
            void qc.invalidateQueries({
              queryKey: ["event", eventId, "survey"],
            });
            setPendingJoin({ slotId });
            setSurveyOpen(true);
            return;
          }
          // 締切前に開いたまま放置されたページからの参加 (#269)。ボタンはまだ
          // 有効なので押せてしまうが、サーバーは 409 で断る。理由を出したうえで
          // イベントを取り直し、締切後の表示（募集は締め切りました）に切り替える。
          // event_ended も同じ経路（開いたまま終了時刻をまたいだ）なので一緒に扱う
          if (code === "registration_closed" || code === "event_ended") {
            setJoinError(
              t(
                code === "registration_closed"
                  ? "eventDetail.joinClosedError"
                  : "eventDetail.joinEndedError",
              ),
            );
            setSurveyOpen(false);
            setPendingJoin(null);
            timing.refresh();
            void qc.invalidateQueries({ queryKey: ["event", eventId] });
          }
        },
      },
    );

  /** 参加操作の入口。アンケートがあれば先に回答ダイアログを開く */
  const requestJoin = (slotId?: string) => {
    setJoinError("");
    if (hasSurvey) {
      setPendingJoin({ slotId });
      setSurveyOpen(true);
    } else {
      doJoin(slotId);
    }
  };

  return (
    <>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        {/* 参加状態のバッジは終了後も表示（参加履歴として残す） */}
        {isMember && myMembership && myRole === "participant" && (
          <Chip
            color={myMembership.status === "confirmed" ? "success" : "default"}
            label={t("eventDetail.myStatus", {
              status: participationStatusLabel(myMembership.status),
            })}
          />
        )}
        {/* 入場QR (#154)。出席チェックモード＋日程確定済みの確定参加者に表示 */}
        {me &&
          myMembership?.status === "confirmed" &&
          event.attendanceCheck &&
          !event.scheduling &&
          !ended && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => setEntranceQrOpen(true)}
            >
              {t("eventDetail.entranceQr")}
            </Button>
          )}
        {/* 参加後もアンケート回答を見直せる (#152) */}
        {isMember && hasSurvey && (
          <Button
            size="small"
            onClick={() => {
              setPendingJoin(null);
              setSurveyOpen(true);
            }}
          >
            {t("eventDetail.editSurveyAnswers")}
          </Button>
        )}
        {ended ? (
          <Chip variant="outlined" label={t("eventDetail.endedChip")} />
        ) : /* 締切後は新規登録だけを止める。既存参加者の解除ボタンは下で出す (#269)。
             未ログインの訪問者にも「ログインして参加」ではなくこの表示を出すのは意図的で、
             ログインしたところで参加できない以上、先に締切を伝えるほうが親切なため */
        registrationClosed && !isMember ? (
          <Chip variant="outlined" label={t("eventDetail.closedChip")} />
        ) : !me ? (
          <Button variant="contained" component={RouterLink} to="/login">
            {t("eventDetail.loginToJoin")}
          </Button>
        ) : isMember ? (
          <Button
            variant="outlined"
            color="error"
            disabled={leave.isPending}
            onClick={() => leave.mutate(eventId)}
          >
            {t("eventDetail.leave")}
          </Button>
        ) : !hasSlots ? (
          <Button
            variant="contained"
            disabled={join.isPending}
            onClick={() => requestJoin()}
          >
            {t("eventDetail.register")}
          </Button>
        ) : null}
      </Stack>

      {/* 参加できなかった理由 (#269)。締切・終了をまたいだページから押したとき、
          無反応にせずここで理由を出す。表示自体は invalidate 後の再描画で
          締切後のものに切り替わる */}
      {joinError && (
        <Alert severity="warning" onClose={() => setJoinError("")}>
          {joinError}
        </Alert>
      )}

      {/* 採点への導線。参加操作と参加枠の間に出す（参加者としての行動なので） */}
      {contest && isMember && state && !state.scoringLocked && (
        <Alert
          severity="info"
          sx={{ alignItems: "center", "& .MuiAlert-message": { flex: 1 } }}
          action={
            <Button
              variant="contained"
              component={RouterLink}
              to={`/events/${eventId}/scoring`}
            >
              {t("eventDetail.scoreNow")}
            </Button>
          }
        >
          {t("eventDetail.scoringOpen")}
        </Alert>
      )}

      {hasSlots && slots && (
        <EventSlots
          slots={slots}
          me={me ?? null}
          isMember={isMember}
          ended={ended}
          closed={registrationClosed}
          joinPending={join.isPending}
          onJoin={(slotId) => requestJoin(slotId)}
        />
      )}

      {/* 入場QRダイアログ (#154)。開いている間だけチケットを取得・自動更新 */}
      {me && entranceQrOpen && (
        <EntranceQrDialog
          eventId={eventId}
          user={me}
          open={entranceQrOpen}
          onClose={() => setEntranceQrOpen(false)}
        />
      )}

      {/* 事前アンケートの回答ダイアログ（参加前の回答／参加後の編集に共用） */}
      {me && surveyQuestions && (hasSurvey || surveyOpen) && (
        <SurveyAnswerDialog
          eventId={eventId}
          questions={surveyQuestions}
          open={surveyOpen}
          onClose={() => setSurveyOpen(false)}
          onSubmitted={
            pendingJoin ? () => doJoin(pendingJoin.slotId) : undefined
          }
          submitLabel={t(
            pendingJoin
              ? "eventDetail.surveySubmitJoin"
              : "eventDetail.surveySubmitSave",
          )}
        />
      )}
    </>
  );
}
