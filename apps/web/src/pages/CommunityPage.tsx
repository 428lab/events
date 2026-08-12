import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import EggIcon from "@mui/icons-material/Egg";
import InsightsIcon from "@mui/icons-material/Insights";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useIsAdmin, useMe } from "../api/hooks.js";
import {
  useCommunity,
  useDeleteCommunity,
  useJoinCommunity,
  useLeaveCommunity,
} from "../api/communityHooks.js";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { RequestCard } from "../components/RequestCard.js";
import { Markdown } from "../components/Markdown.js";
import { tDynamic } from "../i18n/index.js";

export function CommunityPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const isAdmin = useIsAdmin();
  const { data: c, isLoading, isError } = useCommunity(slug);
  const join = useJoinCommunity(slug);
  const leave = useLeaveCommunity(slug);
  const del = useDeleteCommunity();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isError) return <Alert severity="info">{t("community.notFound")}</Alert>;
  if (isLoading || !c) return <Typography>{t("common.loading")}</Typography>;

  const isOwner = c.isOwner;
  const isManager = c.myRole === "owner" || c.myRole === "admin";
  // 立場のラベルはサーバーが返すコードで引く。**どの立場に出すかの判定は
  // 画面側**で、一般メンバーは辞書に無いので空文字になり出ない
  const roleLabel = c.myRole ? tDynamic(`communityRole.${c.myRole}`, "") : "";

  return (
    <Stack spacing={3}>
      {c.bannerUrl && (
        <Box
          component="img"
          src={c.bannerUrl}
          alt=""
          sx={{
            width: "100%",
            aspectRatio: "3 / 1",
            objectFit: "cover",
            borderRadius: 2,
          }}
        />
      )}

      {/* ヘッダー */}
      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        spacing={2}
        alignItems="center"
      >
        <Avatar
          src={c.iconUrl ?? undefined}
          variant="rounded"
          sx={{ width: 72, height: 72, fontSize: 32 }}
        >
          {c.name.charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={700} noWrap>
            {c.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            @{c.slug}
            {t("common.dotSeparator")}
            <Link
              component={RouterLink}
              to={`/c/${slug}/members`}
              color="inherit"
              underline="hover"
            >
              {t(
                c.memberCount === 1
                  ? "community.memberCountOne"
                  : "community.memberCount",
                { n: c.memberCount },
              )}
            </Link>
            {t("common.dotSeparator")}
            {t(
              c.eventCount === 1
                ? "community.eventCountOne"
                : "community.eventCount",
              { n: c.eventCount },
            )}
            {(c.likesReceived ?? 0) > 0 && (
              <>
                {t("common.dotSeparator")}
                {t(
                  c.likesReceived === 1
                    ? "community.likeCountOne"
                    : "community.likeCount",
                  { n: c.likesReceived },
                )}
              </>
            )}
          </Typography>
        </Box>
        {me && (
          <Stack
            direction="row"
            flexWrap="wrap"
            useFlexGap
            spacing={1}
            alignItems="center"
          >
            {roleLabel && (
              <Chip label={roleLabel} color="secondary" size="small" />
            )}
            {/* コミュニティの数字 (#262)。管理者・運営管理者にだけ導線を出す */}
            {(isManager || isAdmin) && (
              <Button
                variant="outlined"
                component={RouterLink}
                to={`/c/${slug}/kpi`}
                startIcon={<InsightsIcon />}
              >
                {t("community.kpi")}
              </Button>
            )}
            {isManager ? (
              <Button
                variant="outlined"
                component={RouterLink}
                to={`/c/${slug}/edit`}
              >
                {t("common.edit")}
              </Button>
            ) : c.isMember ? (
              <Button
                variant="outlined"
                disabled={leave.isPending}
                onClick={() => leave.mutate(c.id)}
              >
                {t("profile.following")}
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={join.isPending}
                onClick={() => join.mutate(c.id)}
              >
                {t("community.follow")}
              </Button>
            )}
            {isOwner && (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setConfirmDelete(true)}
              >
                {t("common.delete")}
              </Button>
            )}
          </Stack>
        )}
      </Stack>

      {c.description && <Markdown>{c.description}</Markdown>}

      {c.links.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {c.links.map((l, i) => (
            <Button
              key={i}
              size="small"
              variant="outlined"
              component="a"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </Button>
          ))}
        </Stack>
      )}

      <Divider />

      {/* イベント（検索APIベース: タブ・絞り込み・10件ページング） */}
      <EventsBrowser communityId={c.id} />

      {/* イベントのたまご（あったらいいな） */}
      {(c.requests.length > 0 || c.isMember) && (
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1 }}
          >
            <Typography
              variant="h6"
              sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <EggIcon fontSize="small" />
              {t("egg.title")}
            </Typography>
            {c.isMember && (
              <Button
                size="small"
                component={RouterLink}
                to={`/requests/new?communityId=${c.id}`}
              >
                {t("egg.postWish")}
              </Button>
            )}
          </Stack>
          {c.requests.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              {t("egg.emptyInCommunity")}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {c.requests.map((r) => (
                <RequestCard key={r.id} request={r} />
              ))}
            </Stack>
          )}
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>{t("community.deleteTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("community.deleteBody", { name: c.name })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            color="error"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(c.id, { onSuccess: () => navigate("/communities") })
            }
          >
            {t("common.deleteSubmit")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
