import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { CommunityMember } from "@eventer/shared";
import {
  useCommunity,
  useCommunityMembers,
  useSetCommunityRole,
  useTransferOwnership,
} from "../api/communityHooks.js";
import { UserLink } from "../components/UserLink.js";

const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
};

/** コミュニティのメンバー一覧ページ（/c/:slug/members）。未ログインでも閲覧可。 */
export function CommunityMembersPage() {
  const { slug = "" } = useParams();
  const { data: c, isLoading, isError } = useCommunity(slug);
  const { data: members } = useCommunityMembers(slug);
  const setRole = useSetCommunityRole(slug);
  const transfer = useTransferOwnership(slug);

  if (isError) return <Alert severity="info">コミュニティが見つかりません。</Alert>;
  if (isLoading || !c) return <Typography>読み込み中…</Typography>;

  const isOwner = c.isOwner;

  const ownerActions = (m: CommunityMember) => (
    <>
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
    </>
  );

  return (
    <Stack spacing={2}>
      <Box>
        <Button
          size="small"
          color="inherit"
          startIcon={<ArrowBackIcon />}
          component={RouterLink}
          to={`/c/${slug}`}
          sx={{ opacity: 0.85 }}
        >
          {c.name}
        </Button>
      </Box>

      <Typography variant="h5" fontWeight={700}>
        メンバー（{members?.length ?? c.memberCount}）
      </Typography>

      {!members || members.length === 0 ? (
        <Typography color="text.secondary">メンバーはいません。</Typography>
      ) : (
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
                avatarSize={40}
              />
              {ROLE_LABEL[m.role] && (
                <Chip label={ROLE_LABEL[m.role]} size="small" />
              )}
              <Box sx={{ flex: 1 }} />
              {isOwner && ownerActions(m)}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
