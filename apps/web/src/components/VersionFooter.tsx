import { Box, Link, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** ビルド日付ベースのバージョンと法務リンクを控えめに表示するフッター */
export function VersionFooter() {
  return (
    <Box sx={{ textAlign: "center", py: 3, opacity: 0.75 }}>
      <Stack
        direction="row"
        spacing={2}
        justifyContent="center"
        sx={{ mb: 0.5 }}
      >
        <Link component={RouterLink} to="/privacy" variant="caption" color="text.secondary">
          プライバシーポリシー
        </Link>
        <Link component={RouterLink} to="/terms" variant="caption" color="text.secondary">
          利用規約
        </Link>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        events lab ・ beta ・ v{__APP_VERSION__}
      </Typography>
    </Box>
  );
}
