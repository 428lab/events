import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useDevLogin } from "../api/hooks.js";

export function LoginPage() {
  const devLogin = useDevLogin();
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent>
          <Stack spacing={3} alignItems="center" sx={{ py: 2 }}>
            <Typography variant="h4" fontWeight={700}>
              events lab
            </Typography>
            <Typography color="text.secondary" textAlign="center">
              アイディアソン・ハッカソン運営ツール
            </Typography>
            <Button
              variant="contained"
              size="large"
              fullWidth
              href="/api/auth/discord/login"
            >
              Discord でログイン
            </Button>
            {import.meta.env.DEV && (
              <>
                <Button
                  variant="outlined"
                  size="large"
                  fullWidth
                  disabled={devLogin.isPending}
                  onClick={() =>
                    devLogin.mutate(undefined, {
                      onSuccess: () => navigate("/me"),
                    })
                  }
                >
                  開発用ログイン
                </Button>
                <Typography variant="caption" color="text.secondary">
                  ※ 開発用ログインは Discord 未設定の開発環境でのみ動作します
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
