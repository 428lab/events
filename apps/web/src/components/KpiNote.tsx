import { useState } from "react";
import { Box, Collapse, IconButton, Typography } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

/**
 * 数字の読み方の注記。常時表示だと本題（数字）より上に長文が居座るため、
 * 既定は1行のリンクだけにして必要なときに開く。
 */
export function KpiNote({
  summary = "数字の読み方",
  children,
}: {
  /** 閉じているときに出す1行 */
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          background: "none",
          border: 0,
          p: 0,
          cursor: "pointer",
          color: "text.secondary",
          font: "inherit",
          "&:hover": { color: "text.primary" },
        }}
      >
        <HelpOutlineIcon sx={{ fontSize: 16 }} />
        <Typography variant="caption">{summary}</Typography>
        <IconButton
          component="span"
          size="small"
          sx={{
            p: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        >
          <ExpandMoreIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 1, lineHeight: 1.8 }}
        >
          {children}
        </Typography>
      </Collapse>
    </Box>
  );
}
