import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { LiveScene } from "@eventer/shared";
import type { LiveSceneCommands } from "../lib/liveScenes.js";
import { LiveSceneStage } from "./LiveStage.js";

/** 一覧に並べるサムネの幅 */
const THUMB_W = 150;

/**
 * シーンの一覧と並べ替え。
 *
 * 中身は配信と同じ LiveSceneStage で描く（別の描き方をすると、一覧では合って
 * いるのに本番でずれる、という食い違いが起きる）。押せるのは枠だけにしたいので
 * 中身側のポインタ操作は切ってある。
 *
 * スライドの一覧と違って **名前を出す**。配信中は名前で切り替えるので、
 * 番号だけでは選べない。
 */
export function LiveSceneList({
  scenes,
  current,
  onSelect,
  commands,
}: {
  scenes: LiveScene[];
  /** いま編集しているシーンの位置 */
  current: number;
  onSelect: (index: number) => void;
  commands: LiveSceneCommands;
}) {
  const { t } = useTranslation();

  return (
    <>
      {scenes.map((s, j) => (
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
            <LiveSceneStage scene={s} width={THUMB_W} />
          </Box>
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              bottom: 2,
              left: 4,
              right: 4,
              px: 0.5,
              borderRadius: 0.5,
              bgcolor: "rgba(0,0,0,0.55)",
              color: "#fff",
              lineHeight: 1.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </Typography>
        </Box>
      ))}
      <Button size="small" onClick={commands.add}>
        {t("studio.addScene")}
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
          {/* 最後の1つは消せない。シーンの無い配信セットを作らせない */}
          <IconButton
            size="small"
            onClick={commands.remove}
            disabled={scenes.length <= 1}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
