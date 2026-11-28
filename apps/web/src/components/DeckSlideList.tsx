import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { DeckSlide } from "@eventer/shared";
import type { DeckSlideCommands } from "../lib/deckSlides.js";
import { SlideStage } from "./SlideStage.js";

/** 一覧に並べるサムネの幅 */
const THUMB_W = 150;

/**
 * ページの一覧と並べ替え。
 *
 * 中身は投影と同じ SlideStage で描く（別の描き方をすると、一覧では合っているのに
 * 本番でずれる、という食い違いが起きる）。押せるのは枠だけにしたいので
 * 中身側のポインタ操作は切ってある。
 */
export function DeckSlideList({
  slides,
  current,
  onSelect,
  commands,
}: {
  slides: DeckSlide[];
  /** いま編集しているページの位置 */
  current: number;
  onSelect: (index: number) => void;
  commands: DeckSlideCommands;
}) {
  const { t } = useTranslation();
  const currentRef = useRef<HTMLDivElement>(null);
  // 一覧は横幅の広い画面では別にスクロールする。選んだページ（矢印で動かした・足した）が
  // 見えるところへ寄せる
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [current, slides.length]);

  return (
    <>
      {/* 横幅の広い画面では、サムネだけをこの枠の中でスクロールする。ページが増えても
          編集画面が上へ流れていかない（親の列が画面の高さに収まる） */}
      <Stack spacing={1} data-testid="deck-slide-thumbs" sx={{ overflowY: { md: "auto" }, flex: { md: "1 1 auto" }, minHeight: { md: 0 }, pr: { md: 0.5 } }}>
      {slides.map((s, j) => (
        <Box
          key={s.id}
          ref={j === current ? currentRef : undefined}
          onClick={() => onSelect(j)}
          sx={{
            flexShrink: 0,
            cursor: "pointer",
            border: "2px solid",
            borderColor: j === current ? "primary.main" : "divider",
            borderRadius: 1,
            position: "relative",
            overflow: "hidden",
            lineHeight: 0,
          }}
        >
          <Box sx={{ pointerEvents: "none" }}>
            <SlideStage slide={s} width={THUMB_W} />
          </Box>
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              top: 2,
              left: 4,
              px: 0.5,
              borderRadius: 0.5,
              bgcolor: "rgba(0,0,0,0.45)",
              color: "#fff",
              lineHeight: 1.4,
            }}
          >
            {j + 1}
          </Typography>
        </Box>
      ))}
      </Stack>
      <Button size="small" onClick={commands.add} sx={{ flexShrink: 0 }}>
        {t("studio.addPage")}
      </Button>
      <Stack direction="row" spacing={0.5} justifyContent="center" sx={{ flexShrink: 0 }}>
        <Tooltip title={t("studio.duplicate")}>
          <IconButton size="small" onClick={commands.duplicate}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("studio.moveUpShort")}>
          <IconButton size="small" onClick={() => commands.move(-1)}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("studio.moveDownShort")}>
          <IconButton size="small" onClick={() => commands.move(1)}>
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("common.delete")}>
          {/* 最後の1枚は消せない。中身の無いデッキを作らせない */}
          <IconButton
            size="small"
            onClick={commands.remove}
            disabled={slides.length <= 1}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
