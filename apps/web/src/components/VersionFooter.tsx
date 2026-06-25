import { Box, Typography } from "@mui/material";

/** ビルド日付ベースのバージョンを控えめに表示するフッター */
export function VersionFooter() {
  return (
    <Box sx={{ textAlign: "center", py: 3, opacity: 0.6 }}>
      <Typography variant="caption" color="text.secondary">
        events lab ・ beta ・ v{__APP_VERSION__}
      </Typography>
    </Box>
  );
}
