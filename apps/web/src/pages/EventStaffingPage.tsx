import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventNoteIcon from "@mui/icons-material/EventNote";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { computeScheduleTimes, publicTracks } from "@eventer/shared";
import { useEvent, useMe } from "../api/hooks.js";
import { useEventSchedule } from "../api/eventScheduleHooks.js";
import {
  useAddDutyAssignee,
  useCreateDuty,
  useDeleteDuty,
  useEventStaffing,
  usePutItemSlots,
  useRemoveDutyAssignee,
  useRenameDuty,
  useReorderDuties,
} from "../api/dutyHooks.js";
import { countUnfilled, deriveSlotBoards } from "../lib/dutyBoard.js";
import { formatTime } from "../lib/format.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { DutyManager } from "../components/DutyManager.js";
import { DutyChips } from "../components/DutyChips.js";
import {
  DutySlotsDialog,
  dutyErrorMessage,
} from "../components/DutySlotsDialog.js";

/**
 * スタッフの役割タグと持ち場 (#384 案S2)。**この画面を束ねるだけ。**
 *
 * 時刻順の項目一覧（staff が取るタイムテーブル）に持ち場のチップを並べ、
 * ここで持ち場の編集と割り当てを行う。上部に集計「埋まっていない持ち場 N」と
 * 「不足のみ」「自分の持ち場」の絞り込み。**埋まっていない持ち場を並べて
 * 潰していく**作業動線が要件3の中心（格子はそれの確認画面）。
 *
 * 見えるのは `myRole === "staff"` の人だけ。**サイト管理者かどうかは混ぜない**
 * （イベント配下の画面はイベント内の役割だけで判定する）。スタッフでなければ
 * 一覧を取りにも行かない（設計 8.3）。
 *
 * 充足（1/2・不足）はサーバーから来ない。`lib/dutyBoard.ts` の純関数で
 * 見るたびに導出する（設計 3.7）。
 */
export function EventStaffingPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: me } = useMe();
  // イベント配下の表示はイベント内の役割だけで判定する
  const isStaff = eventData?.myRole === "staff";
  const { data, error } = useEventStaffing(id, isStaff);
  // タイムテーブル（staff には裏方も入って返る）。持ち場は itemId で突き合わせる
  const { data: timetable } = useEventSchedule(id);

  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [showShort, setShowShort] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const createDuty = useCreateDuty(id);
  const renameDuty = useRenameDuty(id);
  const reorderDuties = useReorderDuties(id);
  const deleteDuty = useDeleteDuty(id);
  const putSlots = usePutItemSlots(id);
  const addAssignee = useAddDutyAssignee(id);
  const removeAssignee = useRemoveDutyAssignee(id);
  const busy =
    createDuty.isPending ||
    renameDuty.isPending ||
    reorderDuties.isPending ||
    deleteDuty.isPending ||
    putSlots.isPending ||
    addAssignee.isPending ||
    removeAssignee.isPending;

  const slots = data?.slots;
  const duties = data?.duties;
  const boards = useMemo(
    () => deriveSlotBoards(slots ?? [], duties ?? [], me?.id ?? null),
    [slots, duties, me],
  );

  const items = timetable?.items ?? [];
  const times = useMemo(
    () =>
      computeScheduleTimes(
        items,
        eventData?.event.startsAt ?? null,
        // 時刻を連鎖させる列は**公開トラックだけ**（EventSchedule と同じ。
        // スタッフ用の列を混ぜると staff の画面でだけ時刻がずれる）
        publicTracks(timetable?.tracks ?? []).map((track) => track.id),
      ),
    [items, eventData, timetable],
  );

  if (!eventData) return <Typography>{t("common.loading")}</Typography>;
  if (!isStaff) {
    return <Alert severity="info">{t("staffOps.dutyStaffOnly")}</Alert>;
  }
  if (!data) {
    return (
      <Typography>
        {t(error ? "staffOps.loadFailed" : "common.loading")}
      </Typography>
    );
  }

  const boardsOf = (itemId: string) =>
    boards.filter((b) => b.slot.itemId === itemId);
  const matches = (itemId: string) =>
    boardsOf(itemId).filter(
      (b) => (!showShort || b.shortage > 0) && (!showMine || b.mine),
    );
  const filtering = showShort || showMine;
  const shownItems = filtering
    ? items.filter((it) => matches(it.id).length > 0)
    : items;
  const unfilled = countUnfilled(boards);
  const openItem = openItemId
    ? (items.find((it) => it.id === openItemId) ?? null)
    : null;

  const fail = (e: unknown) => setFailure(e);
  const clearFail = () => setFailure(null);

  const moveDuty = (dutyId: string, delta: -1 | 1) => {
    const ids = (duties ?? []).map((d) => d.id);
    const at = ids.indexOf(dutyId);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    clearFail();
    reorderDuties.mutate(ids, { onError: fail });
  };

  return (
    <Stack spacing={2}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("staffOps.dutyTitle")}
      />
      <Box>
        <Button
          component={RouterLink}
          to={`/events/${id}`}
          size="small"
          startIcon={<ArrowBackIcon />}
        >
          {t("staffOps.backToEventLink")}
        </Button>
      </Box>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          {t("staffOps.dutyTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("staffOps.dutyPageNote")}
        </Typography>
      </Box>
      {/* #383 との行き来。データでは繋がない（持ち場は itemId でだけ結ぶ） */}
      <Box>
        <Button
          component={RouterLink}
          to={`/events/${id}/timetable`}
          size="small"
          startIcon={<EventNoteIcon />}
        >
          {t("staffOps.dutyToTimetable")}
        </Button>
      </Box>

      {failure !== null && openItemId === null && (
        <Alert severity="error" onClose={clearFail}>
          {dutyErrorMessage(failure)}
        </Alert>
      )}

      <DutyManager
        duties={data.duties}
        slots={data.slots}
        busy={busy}
        onAdd={(name) => {
          clearFail();
          createDuty.mutate(name, { onError: fail });
        }}
        onRename={(dutyId, name) => {
          clearFail();
          renameDuty.mutate({ dutyId, name }, { onError: fail });
        }}
        onMove={moveDuty}
        onDelete={(dutyId) => {
          clearFail();
          deleteDuty.mutate(dutyId, { onError: fail });
        }}
      />

      {/* 集計と絞り込み。不足を並べて潰していくのがこのページの作業動線（要件3） */}
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        {unfilled > 0 ? (
          <Chip
            color="warning"
            label={t("staffOps.dutyUnfilledCount", { n: unfilled })}
          />
        ) : (
          boards.length > 0 && (
            <Chip variant="outlined" label={t("staffOps.dutyAllFilled")} />
          )
        )}
        <Chip
          size="small"
          variant={showShort ? "filled" : "outlined"}
          color={showShort ? "primary" : "default"}
          label={t("staffOps.dutyFilterShort")}
          onClick={() => setShowShort((v) => !v)}
        />
        <Chip
          size="small"
          variant={showMine ? "filled" : "outlined"}
          color={showMine ? "primary" : "default"}
          label={t("staffOps.dutyFilterMine")}
          onClick={() => setShowMine((v) => !v)}
        />
      </Stack>

      {items.length === 0 && (
        <Alert severity="info">{t("staffOps.dutyNoItems")}</Alert>
      )}
      {items.length > 0 && shownItems.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("staffOps.dutyFilterNone")}
        </Typography>
      )}

      <Stack spacing={1}>
        {shownItems.map((item) => {
          const at = items.indexOf(item);
          const time = times[at] ?? null;
          const itemBoards = filtering ? matches(item.id) : boardsOf(item.id);
          return (
            <Card key={item.id} variant="outlined">
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 48 }}
                  >
                    {time !== null ? formatTime(time) : t("staffOps.dutyNoTime")}
                  </Typography>
                  <Typography sx={{ flexGrow: 1 }} noWrap>
                    {item.title}
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => {
                      clearFail();
                      setOpenItemId(item.id);
                    }}
                  >
                    {t("staffOps.dutyEditSlots")}
                  </Button>
                </Stack>
                {itemBoards.length > 0 ? (
                  <Box sx={{ mt: 0.5 }}>
                    <DutyChips
                      boards={itemBoards}
                      onClick={() => {
                        clearFail();
                        setOpenItemId(item.id);
                      }}
                    />
                  </Box>
                ) : (
                  !filtering && (
                    <Typography variant="caption" color="text.secondary">
                      {t("staffOps.dutyNoSlots")}
                    </Typography>
                  )
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {openItem && (
        <DutySlotsDialog
          itemTitle={openItem.title}
          boards={boardsOf(openItem.id)}
          duties={data.duties}
          assignable={data.assignable}
          busy={busy}
          error={failure}
          onPutSlots={(next) => {
            clearFail();
            putSlots.mutate({ itemId: openItem.id, slots: next }, { onError: fail });
          }}
          onAddAssignee={(slotId, userId) => {
            clearFail();
            addAssignee.mutate({ slotId, userId }, { onError: fail });
          }}
          onRemoveAssignee={(slotId, assigneeId) => {
            clearFail();
            removeAssignee.mutate({ slotId, assigneeId }, { onError: fail });
          }}
          onClose={() => {
            clearFail();
            setOpenItemId(null);
          }}
        />
      )}
    </Stack>
  );
}
