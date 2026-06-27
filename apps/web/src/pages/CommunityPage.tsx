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
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import {
  useCommunity,
  useCommunityMembers,
  useDeleteCommunity,
  useJoinCommunity,
  useLeaveCommunity,
  useSetCommunityRole,
  useTransferOwnership,
} from "../api/communityHooks.js";
import { EventCard } from "../components/EventCard.js";
import { UserLink } from "../components/UserLink.js";
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
  const { data: members } = useCommunityMembers(slug);
  const join = useJoinCommunity(slug);
  const leave = useLeaveCommunity(slug);
  const setRole = useSetCommunityRole(slug);
  const transfer = useTransferOwnership(slug);
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
            @{c.slug} ・ メンバー {c.memberCount} ・ イベント {c.eventCount}
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

      {/* イベント */}
      <Box>
        <Typography variant="h6" gutterBottom>
          開催予定・開催中のイベント
        </Typography>
        {c.upcomingEvents.length === 0 ? (
          <Typography color="text.secondary">
            予定されているイベントはありません。
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {c.upcomingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        )}
      </Box>

      {c.pastEvents.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            過去のイベント
          </Typography>
          <Stack spacing={1.5}>
            {c.pastEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </Stack>
        </Box>
      )}

      {/* メンバー */}
      {members && members.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            メンバー（{members.length}）
          </Typography>
          {isOwner ? (
            <Stack divider={<Divider flexItem />} spacing={1}>
              {members.map((m) => (
                <Stack
                  key={m.userId}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ flexWrap: "wrap" }}
                >
                  <UserLink
                    username={m.username}
                    name={m.name}
                    avatarUrl={m.avatarUrl}
                    withAvatar
                    avatarSize={32}
                  />
                  {ROLE_LABEL[m.role] && (
                    <Chip label={ROLE_LABEL[m.role]} size="small" />
                  )}
                  <Box sx={{ flex: 1 }} />
                  {m.role === "member" && (
                    <Button
                      size="small"
                      disabled={setRole.isPending}
                      onClick={() =>
                        setRole.mutate({
                          communityId: c.id,
                          userId: m.userId,
                          role: "admin",
                        })
                      }
                    >
                      管理者にする
                    </Button>
                  )}
                  {m.role === "admin" && (
                    <>
                      <Button
                        size="small"
                        disabled={setRole.isPending}
                        onClick={() =>
                          setRole.mutate({
                            communityId: c.id,
                            userId: m.userId,
                            role: "member",
                          })
                        }
                      >
                        メンバーに戻す
                      </Button>
                      <Button
                        size="small"
                        color="secondary"
                        disabled={transfer.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `${m.name} にオーナーを譲渡します。あなたは管理者になります。よろしいですか？`,
                            )
                          ) {
                            transfer.mutate({
                              communityId: c.id,
                              toUserId: m.userId,
                            });
                          }
                        }}
                      >
                        オーナー譲渡
                      </Button>
                    </>
                  )}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {members.map((m) => (
                <Stack
                  key={m.userId}
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                >
                  <UserLink
                    username={m.username}
                    name={m.name}
                    avatarUrl={m.avatarUrl}
                    withAvatar
                    avatarSize={32}
                  />
                  {ROLE_LABEL[m.role] && (
                    <Chip label={ROLE_LABEL[m.role]} size="small" />
                  )}
                </Stack>
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
