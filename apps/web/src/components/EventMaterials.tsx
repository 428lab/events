import { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  IconButton,
  Typography,
} from "@mui/material";
import CollectionsBookmarkOutlinedIcon from "@mui/icons-material/CollectionsBookmarkOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import type { ScheduleItem } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import { useEventSchedule } from "../api/eventScheduleHooks.js";
import { MaterialEditDialog } from "./MaterialEditDialog.js";
import { UserLink } from "./UserLink.js";

/** 登壇資料のギャラリー (#149)。タイムテーブルのコマのうち資料URLがあるものを
 * OGサムネイル付きカードで一覧する。資料が1件もなければ非表示。 */
export function EventMaterials({ eventId }: { eventId: string }) {
  const { data: items } = useEventSchedule(eventId);
  const { data: me } = useMe();
  const [editing, setEditing] = useState<ScheduleItem | null>(null);

  const materials = (items ?? []).filter((it) => it.materialUrl !== "");
  if (materials.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1.5 }}
        >
          <CollectionsBookmarkOutlinedIcon fontSize="small" />
          登壇資料
        </Typography>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 1.5,
          }}
        >
          {materials.map((it) => {
            const isOwn = Boolean(me && it.speaker && it.speaker.id === me.id);
            return (
              <Card
                key={it.id}
                variant="outlined"
                sx={{
                  position: "relative",
                  transition: "border-color 0.15s",
                  "&:hover": { borderColor: "text.secondary" },
                }}
              >
                {/* カード全体を資料へのリンクにする（a のネストを避ける stretched link） */}
                <Box
                  component="a"
                  href={it.materialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`登壇資料を開く: ${it.title}`}
                  sx={{ position: "absolute", inset: 0, zIndex: 1 }}
                />
                {/* サムネイル（OG画像が無ければプレースホルダー） */}
                <Box
                  sx={{
                    position: "relative",
                    aspectRatio: "16 / 10",
                    bgcolor: "action.hover",
                    overflow: "hidden",
                  }}
                >
                  <DescriptionOutlinedIcon
                    sx={{
                      fontSize: 40,
                      color: "text.disabled",
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                  {it.materialOgImage ? (
                    <Box
                      component="img"
                      src={it.materialOgImage}
                      alt=""
                      loading="lazy"
                      // 第三者ホストへの参照なのでリファラは送らない。読込失敗時はプレースホルダに戻す
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                      sx={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}
                </Box>
                <Box sx={{ p: 1.25 }}>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      mb: 0.5,
                    }}
                  >
                    {it.title}
                  </Typography>
                  {it.speaker ? (
                    // リンクは重ねリンクの上に出す（プロフィールへ飛べるように）
                    <Box sx={{ position: "relative", zIndex: 2, display: "inline-flex" }}>
                      <UserLink
                        username={it.speaker.username}
                        name={it.speaker.globalName ?? it.speaker.username}
                        avatarUrl={it.speaker.avatarUrl}
                        withAvatar
                        avatarSize={20}
                        sx={{ fontSize: "0.8125rem" }}
                      />
                    </Box>
                  ) : it.speakerName ? (
                    <Typography variant="caption" color="text.secondary">
                      {it.speakerName}
                    </Typography>
                  ) : null}
                </Box>
                {/* 登壇者本人だけに出す編集ボタン（カードのリンク遷移は抑止する） */}
                {isOwn && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditing(it);
                    }}
                    title="資料URLを編集"
                    sx={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      zIndex: 2,
                      bgcolor: "background.paper",
                      "&:hover": { bgcolor: "background.paper" },
                    }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                )}
              </Card>
            );
          })}
        </Box>

        {editing && (
          <MaterialEditDialog
            eventId={eventId}
            item={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
