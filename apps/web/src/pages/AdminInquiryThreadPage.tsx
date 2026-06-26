import { Alert, Avatar, Box, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useIsAdmin } from "../api/hooks.js";
import {
  useAdminInquiry,
  usePostAdminMessage,
} from "../api/inquiryHooks.js";
import { InquiryThread } from "../components/InquiryThread.js";

export function AdminInquiryThreadPage() {
  const { id = "" } = useParams();
  const isAdmin = useIsAdmin();
  const { data, isLoading, isError } = useAdminInquiry(id);
  const post = usePostAdminMessage(id);

  if (!isAdmin) return <Alert severity="info">運営管理者専用です。</Alert>;
  if (isError) return <Alert severity="info">お問い合わせが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/admin/inquiries"
        size="small"
        sx={{ alignSelf: "flex-start" }}
      >
        ← お問い合わせ管理へ
      </Button>
      {data.userId && (
        <Box
          component={RouterLink}
          to={`/users/${data.userId}`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            textDecoration: "none",
            color: "inherit",
            alignSelf: "flex-start",
            "&:hover .name": { textDecoration: "underline" },
          }}
        >
          <Avatar
            src={data.userAvatarUrl ?? undefined}
            sx={{ width: 32, height: 32 }}
          >
            {data.userName?.charAt(0)}
          </Avatar>
          <Box>
            <Typography className="name" variant="body2" fontWeight={600}>
              {data.userName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              プロフィールを見る
            </Typography>
          </Box>
        </Box>
      )}
      <InquiryThread
        detail={data}
        selfSender="admin"
        onSend={(body) => post.mutate(body)}
        sending={post.isPending}
      />
    </Stack>
  );
}
