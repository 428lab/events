import { Alert, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useInquiry, usePostInquiryMessage } from "../api/inquiryHooks.js";
import { InquiryThread } from "../components/InquiryThread.js";

export function InquiryThreadPage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useInquiry(id);
  const post = usePostInquiryMessage(id);

  if (isError) return <Alert severity="info">お問い合わせが見つかりません。</Alert>;
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/inquiries"
        size="small"
        sx={{ alignSelf: "flex-start" }}
      >
        ← お問い合わせ一覧へ
      </Button>
      <InquiryThread
        detail={data}
        selfSender="user"
        onSend={(body) => post.mutate(body)}
        sending={post.isPending}
      />
    </Stack>
  );
}
