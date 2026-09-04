import type { ReactNode } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Button, Chip, Stack } from "@mui/material";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import BadgeIcon from "@mui/icons-material/Badge";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignIcon from "@mui/icons-material/Campaign";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import CasinoOutlinedIcon from "@mui/icons-material/CasinoOutlined";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import PollOutlinedIcon from "@mui/icons-material/PollOutlined";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
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

/**
 * イベント配下の各画面への導線 (#393 #382 #384 #431 #436 #444 ほか)。
 * 参加者本人にだけ出す。スタッフ向けの運営画面はここに集めてある。
 *
 * スタッフ用の画面が増えるたびに同じ形のボタンが積み上がっていたので、
 * 違うところ（遷移先・文言・アイコン・出す条件）だけを表に持たせて1回で描く。
 */
export function EventActionButtons({
  eventId,
  isMember,
  isStaff,
  contest,
  attendanceCheck,
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
    { path: "edit", labelKey: "common.edit", variant: "contained", show: isStaff },
    // ここから運営用（myRole === "staff" のときだけ。isAdmin は混ぜない #275）
    { path: "live/control", labelKey: "eventDetail.live", icon: <LiveTvIcon />, show: isStaff },
    { path: "broadcast", labelKey: "eventDetail.broadcast", icon: <CampaignIcon />, show: isStaff },
    { path: "todos", labelKey: "staffOps.todoTitle", icon: <ChecklistIcon />, show: isStaff },
    { path: "staff-chat", labelKey: "staffOps.staffChatTitle", icon: <ForumOutlinedIcon />, show: isStaff },
    { path: "staffing", labelKey: "staffOps.dutyTitle", icon: <AssignmentIndOutlinedIcon />, show: isStaff },
    { path: "prize-desk", labelKey: "staffOps.prizeDeskTitle", icon: <CardGiftcardIcon />, show: isStaff },
    { path: "bingo/control", labelKey: "staffOps.bingoControlTitle", icon: <CasinoOutlinedIcon />, show: isStaff },
    { path: "pre-survey", labelKey: "staffOps.preSurveyTitle", icon: <PollOutlinedIcon />, show: isStaff },
    { path: "stats", labelKey: "eventDetail.stats", icon: <BarChartIcon />, show: isStaff },
    {
      path: "checkin",
      labelKey: "eventDetail.checkin",
      icon: <QrCodeScannerIcon />,
      show: isStaff && attendanceCheck,
    },
    { path: "name-cards", labelKey: "eventDetail.nameCards", icon: <BadgeIcon />, show: isStaff },
    // コンテストの運営設定
    { path: "control", labelKey: "eventDetail.control", show: contest && isStaff },
    { path: "criteria", labelKey: "eventDetail.criteria", show: contest && isStaff },
    { path: "awards", labelKey: "eventDetail.awards", show: contest && isStaff },
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
