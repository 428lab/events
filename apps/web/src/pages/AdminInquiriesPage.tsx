import {
  Alert,
  Avatar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminInquiries } from "../api/inquiryHooks.js";
import { formatDateTime } from "../lib/format.js";

export function AdminInquiriesPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { data: inquiries, isLoading } = useAdminInquiries();

  if (!isAdmin) {
    return <Alert severity="info">運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        お問い合わせ管理
      </Typography>

      {isLoading || !inquiries ? (
        <Typography>読み込み中…</Typography>
      ) : inquiries.length === 0 ? (
        <Typography color="text.secondary">お問い合わせはありません。</Typography>
      ) : (
        <Stack spacing={1.5}>
          {inquiries.map((q) => (
            <Card key={q.id} variant="outlined">
              <CardActionArea component={RouterLink} to={`/admin/inquiries/${q.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    {q.unread && (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: "error.main",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Avatar
                      src={q.userAvatarUrl ?? undefined}
                      title={`${q.userName} のプロフィール`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/users/${q.userId}`);
                      }}
                      sx={{ width: 28, height: 28, cursor: "pointer" }}
                    >
                      {q.userName.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: q.unread ? 700 : 400 }} noWrap>
                        {q.subject}
                      </Typography>
                      <Box
                        component="span"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate(`/users/${q.userId}`);
                        }}
                        sx={{
                          fontSize: 12,
                          color: "text.secondary",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        {q.userName}
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                      >
                        {" "}
                        ・ {formatDateTime(q.lastMessageAt)}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={q.status === "answered" ? "回答済み" : "対応中"}
                      color={q.status === "answered" ? "success" : "warning"}
                    />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
