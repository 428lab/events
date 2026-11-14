import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, type ButtonProps } from "@mui/material";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import type { Event } from "@eventer/shared";
import { useEventMembers, useMe } from "../api/hooks.js";
import { findMyMembership } from "../lib/eventMembership.js";
import { EntranceQrDialog } from "./EntranceQrDialog.js";

/** 入場QR (#154) を出してよいか。出席チェックモード＋日程確定済み＋終了前の、確定参加者だけ。
 * 出す条件はここ1か所（ファーストビューと参加パネルの両方がこれを使う） */
export function useCanShowEntranceQr(eventId: string, event: Event, ended: boolean): boolean {
  const { data: me } = useMe();
  const { data: members } = useEventMembers(eventId, true);
  const myMembership = findMyMembership(members, me);
  return Boolean(
    me && myMembership?.status === "confirmed" && event.attendanceCheck && !event.scheduling && !ended,
  );
}

/** 入場QRのボタンとダイアログ。ダイアログを開いている間だけチケットを取得・自動更新する */
export function EntranceQrButton({
  eventId,
  event,
  ended,
  variant = "outlined",
  size = "small",
}: {
  eventId: string;
  event: Event;
  ended: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canShow = useCanShowEntranceQr(eventId, event, ended);
  const [open, setOpen] = useState(false);
  if (!canShow || !me) return null;
  return (
    <>
      <Button size={size} variant={variant} startIcon={<QrCode2Icon />} onClick={() => setOpen(true)}>
        {t("eventDetail.entranceQr")}
      </Button>
      {open && <EntranceQrDialog eventId={eventId} user={me} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
