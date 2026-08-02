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
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import {
  useCommunity,
  useDeleteCommunity,
  useJoinCommunity,
  useLeaveCommunity,
} from "../api/communityHooks.js";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { RequestCard } from "../components/RequestCard.js";
import { Markdown } from "../components/Markdown.js";

const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

export function CommunityPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: c, isLoading, isError } = useCommunity(slug);
  const join = useJoinCommunity(slug);
  const leave = useLeaveCommunity(slug);
  const del = useDeleteCommunity();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isError) return <Alert severity="info">コミュニティが見つかりません。</Alert>;
  if (isLoading || !c) return <Typography>読み込み中…</Typography>;

  const isOwner = c.isOwner;
  const isManager = c.myRole === "owner" || c.myRole === "admin";

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
      <Stack direction="row" spacing={2} alignItems="center">
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
            @{c.slug} ・{" "}
            <Link
              component={RouterLink}
              to={`/c/${slug}/members`}
              color="inherit"
              underline="hover"
            >
              メンバー {c.memberCount}
            </Link>{" "}
            ・ イベント {c.eventCount}
          </Typography>
        </Box>
        {me && (
          <Stack direction="row" spacing={1} alignItems="center">
            {c.myRole && ROLE_LABEL[c.myRole] && (
              <Chip
                label={ROLE_LABEL[c.myRole]}
                color="secondary"
                size="small"
              />
            )}
            {isManager ? (
              <Button
                variant="outlined"
                component={RouterLink}
                to={`/c/${slug}/edit`}
              >
                編集
              </Button>
            ) : c.isMember ? (
              <Button
                variant="outlined"
                disabled={leave.isPending}
                onClick={() => leave.mutate(c.id)}
              >
                フォロー中
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={join.isPending}
                onClick={() => join.mutate(c.id)}
              >
                フォロー
              </Button>
            )}
            {isOwner && (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setConfirmDelete(true)}
              >
                削除
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
              イベントのたまご
            </Typography>
            {c.isMember && (
              <Button
                size="small"
                component={RouterLink}
                to={`/requests/new?communityId=${c.id}`}
              >
                あったらいいなを投稿
              </Button>
            )}
          </Stack>
          {c.requests.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              まだたまごはありません。
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
        <DialogTitle>コミュニティを削除しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            「{c.name}」を削除します。所属イベントは無所属に戻ります（イベント自体は削除されません）。この操作は取り消せません。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>キャンセル</Button>
          <Button
            color="error"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(c.id, { onSuccess: () => navigate("/communities") })
            }
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
