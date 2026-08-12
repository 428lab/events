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
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { CommunityMember } from "@eventer/shared";
import {
  useCommunity,
  useCommunityMembers,
  useSetCommunityRole,
  useTransferOwnership,
} from "../api/communityHooks.js";
import { UserLink } from "../components/UserLink.js";
import { tDynamic } from "../i18n/index.js";

/** コミュニティのメンバー一覧ページ（/c/:slug/members）。未ログインでも閲覧可。 */
export function CommunityMembersPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const { data: c, isLoading, isError } = useCommunity(slug);
  const { data: members } = useCommunityMembers(slug);
  const setRole = useSetCommunityRole(slug);
  const transfer = useTransferOwnership(slug);

  if (isError) return <Alert severity="info">{t("community.notFound")}</Alert>;
  if (isLoading || !c) return <Typography>{t("common.loading")}</Typography>;

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
          {t("community.makeAdmin")}
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
            {t("community.makeMember")}
          </Button>
          <Button
            size="small"
            color="secondary"
            disabled={transfer.isPending}
            onClick={() => {
              if (
                window.confirm(t("community.transferConfirm", { name: m.name }))
              ) {
                transfer.mutate({
                  communityId: c.id,
                  toUserId: m.userId,
                });
              }
            }}
          >
            {t("community.transferOwner")}
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
        {t("community.membersHeading", { n: members?.length ?? c.memberCount })}
      </Typography>

      {!members || members.length === 0 ? (
        <Typography color="text.secondary">
          {t("community.membersEmpty")}
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={1}>
          {members.map((m) => {
            // 立場のラベルはサーバーが返すコードで引く。一般メンバーは辞書に
            // 無いので空文字になり、今までどおりラベルが出ない
            const roleLabel = tDynamic(`communityRole.${m.role}`, "");
            return (
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
                {roleLabel && <Chip label={roleLabel} size="small" />}
                <Box sx={{ flex: 1 }} />
                {isOwner && ownerActions(m)}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
