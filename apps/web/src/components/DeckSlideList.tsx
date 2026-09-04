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

  return (
    <>
      {slides.map((s, j) => (
        <Box
          key={s.id}
          onClick={() => onSelect(j)}
          sx={{
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
      <Button size="small" onClick={commands.add}>
        {t("studio.addPage")}
      </Button>
      <Stack direction="row" spacing={0.5} justifyContent="center">
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
