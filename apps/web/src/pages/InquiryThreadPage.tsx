import { Alert, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useInquiry, usePostInquiryMessage } from "../api/inquiryHooks.js";
import { InquiryThread } from "../components/InquiryThread.js";

export function InquiryThreadPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useInquiry(id);
  const post = usePostInquiryMessage(id);

  if (isError) return <Alert severity="info">{t("inquiries.notFound")}</Alert>;
  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;

  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/inquiries"
        size="small"
        sx={{ alignSelf: "flex-start" }}
      >
        {t("inquiries.backToList")}
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
