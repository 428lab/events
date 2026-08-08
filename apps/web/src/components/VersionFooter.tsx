import { Box, Link, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** ビルド日付ベースのバージョンと法務リンクを控えめに表示するフッター
 *
 * version-footer は印刷時に消すための目印。Layout の Container の外にいるので、
 * 名札の一括印刷 (#304) のような「用紙だけ刷る」画面ではこれが最後の用紙のあとに
 * 流れ、フッターだけの紙が1枚余分に出る。クラス名は消す側から参照している */
export function VersionFooter() {
  return (
    <Box
      className="version-footer"
      sx={{ textAlign: "center", py: 3, opacity: 0.75 }}
    >
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
