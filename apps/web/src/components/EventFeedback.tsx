import type { ReactNode } from "react";
import {
  Avatar,
  Box,
  Card,
  CardContent,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Event, EventLikeKind } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import { useEventLikes, useSetEventLike } from "../api/eventLikeHooks.js";

/** いいねの1行（対象の表示＋トグルボタン＋件数） */
function LikeRow({
  icon,
  label,
  caption,
  count,
  on,
  disabled,
  disabledReason,
  onToggle,
}: {
  icon: ReactNode;
  label: ReactNode;
  caption: string;
  count: number;
  on: boolean;
  disabled: boolean;
  disabledReason?: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const button = (
    <IconButton
      size="small"
      color={on ? "primary" : "default"}
      disabled={disabled}
      onClick={onToggle}
      aria-label={on ? t("eventSocial.likeOff") : t("eventSocial.likeOn")}
    >
      {on ? (
        <ThumbUpAltIcon fontSize="small" />
      ) : (
        <ThumbUpOffAltIcon fontSize="small" />
      )}
    </IconButton>
  );
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap component="div">
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      </Box>
      {disabled && disabledReason ? (
        <Tooltip title={disabledReason}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 24, textAlign: "right" }}
      >
        {count}
      </Typography>
    </Stack>
  );
}

/** いいねフィードバック (#155)。参加確定メンバーだけに表示し、開始後から押せる。
 * 誰が押したかは表示しない（件数と自分の状態のみ） */
export function EventFeedback({
  eventId,
  event,
  community,
  canLike,
}: {
  eventId: string;
  event: Event;
  community: { id: string; name: string; iconUrl: string | null } | null;
  /** 参加確定メンバーか（myRole＋メンバー情報から呼び出し側で判定） */
  canLike: boolean;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // 開催日時が確定し開始済みのイベントのみ（日程調整中・開始前は非表示）
  const started =
    !event.scheduling && event.startsAt > 0 && event.startsAt <= Date.now();
  const enabled = canLike && started;
  const { data: summary } = useEventLikes(eventId, enabled);
  const setLike = useSetEventLike(eventId);

  if (!enabled) return null;

  const isMine = (kind: EventLikeKind, targetKey: string) =>
    summary?.mine.some((m) => m.kind === kind && m.targetKey === targetKey) ??
    false;
  const toggle = (kind: EventLikeKind, targetKey: string) => {
    if (setLike.isPending) return;
    setLike.mutate({ kind, targetKey, on: !isMine(kind, targetKey) });
  };

  const userAvatar = (t: { username: string; name: string; avatarUrl: string | null }) => (
    <Avatar
      src={t.avatarUrl ?? undefined}
      component={RouterLink}
      to={`/users/${t.username}`}
      sx={{ width: 32, height: 32, fontSize: 14, textDecoration: "none" }}
    >
      {t.name.charAt(0)}
    </Avatar>
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}
        >
          <ThumbUpOutlinedIcon fontSize="small" />
          {t("eventSocial.feedbackHeading")}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1.5 }}
        >
          {t("eventSocial.feedbackIntro")}
        </Typography>

        {!summary ? (
          <Typography variant="body2" color="text.secondary">
            {t("common.loading")}
          </Typography>
        ) : (
          // 行の説明のうち「スタッフ」「参加者」はイベント内の立場そのものなので、
          // `role` の表 (i18n/messages/labels.ts) を引く。ここに書き写すと
          // 同じ文言が2か所になり、片方だけ直る事故が起きる
          <Stack spacing={1.5}>
            <LikeRow
              icon={
                <Avatar sx={{ width: 32, height: 32 }} variant="rounded">
                  <EventIcon fontSize="small" />
                </Avatar>
              }
              label={event.title}
              caption={t("eventSocial.likeCaptionEvent")}
              count={summary.event}
              on={isMine("event", "")}
              disabled={setLike.isPending}
              onToggle={() => toggle("event", "")}
            />
            {summary.host && (
              <LikeRow
                icon={userAvatar(summary.host)}
                label={summary.host.name}
                caption={t("eventSocial.likeCaptionHost")}
                count={summary.host.count}
                on={isMine("host", summary.host.userId)}
                disabled={setLike.isPending || summary.host.userId === me?.id}
                disabledReason={
                  summary.host.userId === me?.id
                    ? t("eventSocial.likeSelfDisabled")
                    : undefined
                }
                onToggle={() => toggle("host", summary.host!.userId)}
              />
            )}
            {summary.staff.map((s) => (
              <LikeRow
                key={s.userId}
                icon={userAvatar(s)}
                label={s.name}
                caption={t("role.staff")}
                count={s.count}
                on={isMine("staff", s.userId)}
                disabled={setLike.isPending || s.userId === me?.id}
                disabledReason={
                  s.userId === me?.id
                    ? t("eventSocial.likeSelfDisabled")
                    : undefined
                }
                onToggle={() => toggle("staff", s.userId)}
              />
            ))}
            {community && (
              <LikeRow
                icon={
                  <Avatar
                    src={community.iconUrl ?? undefined}
                    variant="rounded"
                    sx={{ width: 32, height: 32, fontSize: 14 }}
                  >
                    {community.iconUrl ? null : <GroupsIcon fontSize="small" />}
                  </Avatar>
                }
                label={community.name}
                caption={t("eventSocial.likeCaptionCommunity")}
                count={summary.community}
                on={isMine("community", community.id)}
                disabled={setLike.isPending}
                onToggle={() => toggle("community", community.id)}
              />
            )}
            {summary.participants.map((p) => (
              <LikeRow
                key={p.userId}
                icon={userAvatar(p)}
                label={p.name}
                caption={t("role.participant")}
                count={p.count}
                on={isMine("participant", p.userId)}
                disabled={setLike.isPending || p.userId === me?.id}
                disabledReason={
                  p.userId === me?.id
                    ? t("eventSocial.likeSelfDisabled")
                    : undefined
                }
                onToggle={() => toggle("participant", p.userId)}
              />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
