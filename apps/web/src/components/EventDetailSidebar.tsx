import type { ReactNode } from "react";
import { Stack } from "@mui/material";

/** 右列はカードを縮めず、列全体をスクロールする (#497)。 */
export function EventDetailSidebar({ children }: { children: ReactNode }) {
  return (
    <Stack
      spacing={2}
      sx={{
        position: { md: "sticky" },
        top: { md: 16 },
        maxHeight: { md: "calc(100vh - 32px)" },
        overflowY: { md: "auto" },
        // Card は overflow:hidden。縦flexの既定の縮小を許すと、
        // 列ではなくカードの内側で参加者が切れ、スクロールでも届かない。
        "& > *": { flexShrink: 0 },
      }}
    >
      {children}
    </Stack>
  );
}
