import type { ReactNode } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Button, Chip, Stack } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";

/** 導線ボタン1つぶん。同じ形のボタンが十数個あるので、違うところだけを表に持つ */
interface ActionLink {
  /** イベント配下の遷移先（/events/:id/ の後ろ） */
  path: string;
  /** 翻訳キー。誤記を型で弾く (#352) */
  labelKey: ParseKeys;
  icon?: ReactNode;
  variant?: "outlined" | "contained";
  color?: "primary" | "secondary" | "error";
  /** 出す条件。false の行は描画しない */
  show: boolean;
}

/** Ordinary participant links, including staff acting for themselves. */
export function EventActionButtons({
  eventId,
  isMember,
  contest,
}: {
  eventId: string;
  isMember: boolean;
  isStaff: boolean;
  contest: boolean;
  attendanceCheck: boolean;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // 未ログインでは進行状態を取りに行かない（ページ本体と同じ条件にそろえる）
  const { data: state } = useEventState(eventId, Boolean(me));

  if (!isMember) return null;

  const links: ActionLink[] = [
    // 進行中のモードへの飛び込み口。押し間違えないよう色で区別する
    {
      path: "present",
      labelKey: "eventDetail.toPresentation",
      variant: "contained",
      color: "error",
      show: contest && state?.mode === "presentation",
    },
    {
      path: "awards",
      labelKey: "eventDetail.toAwards",
      variant: "contained",
      color: "secondary",
      show: contest && state?.mode === "awards",
    },
    { path: "scoring", labelKey: "eventDetail.scoring", show: contest },

  ];

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {contest && state && state.mode !== "normal" && (
        <Chip
          color={state.mode === "presentation" ? "error" : "primary"}
          label={t("eventDetail.modeRunning", {
            mode: t(
              state.mode === "presentation"
                ? "eventDetail.modePresentation"
                : state.mode === "aggregation"
                  ? "eventDetail.modeAggregation"
                  : "eventDetail.modeAwards",
            ),
          })}
        />
      )}
      {links
        .filter((l) => l.show)
        .map((l) => (
          <Button
            key={`${l.path}:${l.labelKey}`}
            variant={l.variant ?? "outlined"}
            color={l.color}
            startIcon={l.icon}
            component={RouterLink}
            to={`/events/${eventId}/${l.path}`}
          >
            {t(l.labelKey)}
          </Button>
        ))}
    </Stack>
  );
}
