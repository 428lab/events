import { useState } from "react";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import type { TimetableEntry, TimetableLayout } from "../lib/timetableLayout.js";
import { entriesForTrack } from "../lib/timetableLayout.js";
import { formatTime } from "../lib/format.js";
import { UserLink } from "./UserLink.js";

/** 狭い画面のタイムテーブル (#338)。
 * トラックを横に並べられないので、トラック選択のタブ＋時刻順の縦一覧に落とす。
 * **全トラック共通のコマはどのタブにも出す**（開会・休憩はどの列の人にも要る）。
 * どのタブでも同じ行が出ることになるので、共通の行にはラベルを付けて区別する。 */
export function TimetableTrackTabs({
  layout,
  colors,
}: {
  layout: TimetableLayout;
  /** `null` はスタッフ用の列 (#383)。色を持たず無彩色＋斜線で描く */
  colors: Array<string | null>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const { tracks } = layout;
  if (tracks.length === 0) return null;
  const current = Math.min(tab, tracks.length - 1);
  const entries = entriesForTrack(layout, current);

  return (
    <Box>
      <Tabs
        value={current}
        onChange={(_, v: number) => setTab(v)}
        // 3本までは等幅で全部見える。増えたら横スクロールに逃がす
        variant={tracks.length <= 3 ? "fullWidth" : "scrollable"}
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={t("schedule.chooseTrack")}
        sx={{ borderBottom: 1, borderColor: "divider", minHeight: 42 }}
      >
        {tracks.map((track, i) => (
          <Tab
            key={track.id}
            // 長い名前は折り返さず省略する。折り返すとタブの高さが揃わず、
            // 押せる範囲がトラックごとにばらつく
            label={
              <Box
                component="span"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}
              >
                {track.name}
              </Box>
            }
            sx={{
              minHeight: 42,
              minWidth: 0,
              textTransform: "none",
              maxWidth: "100%",
            }}
            icon={
              // スタッフ用の列は色を持たない (#383)。公開トラックの色を
              // 借りると、参加者の画面と色の対応がずれる
              colors[i] ? (
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "2px",
                    bgcolor: colors[i]!,
                  }}
                />
              ) : (
                <LockOutlinedIcon
                  sx={{ fontSize: 13 }}
                  titleAccess={t("schedule.staffTrack")}
                />
              )
            }
            iconPosition="start"
          />
        ))}
      </Tabs>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1 }}
      >
        {t("schedule.allTracksNote")}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("schedule.trackEmpty")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1 }}>
          {entries.map((entry) => (
            <TimetableRow key={entry.item.id} entry={entry} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** 縦一覧の1行。時刻・内容・担当の並びは既存の一覧に合わせる */
function TimetableRow({ entry }: { entry: TimetableEntry }) {
  const { t } = useTranslation();
  const it = entry.item;
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{ py: 1.25, borderBottom: 1, borderColor: "divider" }}
    >
      <Box sx={{ width: 56, flex: "none" }}>
        <Typography variant="body2" fontWeight={700}>
          {entry.startsAt !== null ? formatTime(entry.startsAt) : "--:--"}
        </Typography>
        {it.durationMin > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("schedule.durationMin", { n: it.durationMin })}
          </Typography>
        )}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {/* ラベルは Chip ごと折り返す。長い題名の後ろに置くと、行に入り切らない
            ぶんが画面の外へはみ出す */}
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="baseline"
          sx={{ flexWrap: "wrap" }}
          useFlexGap
        >
          <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
            {it.title}
          </Typography>
          {entry.common && (
            <Chip
              size="small"
              label={t("schedule.allTracks")}
              sx={{
                height: 17,
                fontSize: "0.65rem",
                bgcolor: (theme) => alpha(theme.palette.text.primary, 0.14),
              }}
            />
          )}
          {/* 裏方 (#383)。サーバーが staff にしか返さないので、ここに来ている
              時点で見てよい人が見ている。参加者には出ないことを印で伝える */}
          {entry.staffOnly && (
            <Chip
              size="small"
              variant="outlined"
              icon={<LockOutlinedIcon sx={{ fontSize: 12 }} />}
              label={t("schedule.staffOnlyChip")}
              sx={{ height: 17, fontSize: "0.65rem" }}
            />
          )}
        </Stack>
        {it.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", whiteSpace: "pre-wrap" }}
          >
            {it.description}
          </Typography>
        )}
        {it.speaker ? (
          <UserLink
            username={it.speaker.username}
            name={it.speaker.globalName ?? it.speaker.username}
            avatarUrl={it.speaker.avatarUrl}
            withAvatar
            avatarSize={20}
            sx={{ fontSize: "0.8125rem", mt: 0.25 }}
          />
        ) : it.speakerName ? (
          <Typography variant="body2" color="text.secondary">
            {it.speakerName}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}
