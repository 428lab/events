import { useState } from "react";
import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import type { EventTimelinePhotos, MediaKind } from "@eventer/shared";
import {
  VideoThumbOverlay,
  eventMediaPosterUrl,
  eventMediaThumbUrl,
  eventMediaVideoUrl,
} from "./videoThumb.js";

/**
 * 年表カードに添える公開写真・動画のサムネイル一式 (#315, #408)。
 * ParticipationTimeline から分離（1ファイル800行の枠と、写真表示の責務分離）。
 */

/** 拡大表示中のメディア */
export interface OpenPhoto {
  eventId: string;
  eventTitle: string;
  items: Array<{ id: string; kind: MediaKind }>;
  index: number;
}

/** カードに添える公開写真のサムネイル。コメントが多い順に数枚だけ並べ、
 * コメント数そのものは出さない（並び順の基準としてしか使わない）。
 * 残りは「+N」でだけ示す。動画はポスターに小さな再生アイコンを重ねる */
export function TimelinePhotoStrip({
  eventId,
  eventTitle,
  photos,
  onOpen,
}: {
  eventId: string;
  eventTitle: string;
  photos: EventTimelinePhotos;
  onOpen: (p: OpenPhoto) => void;
}) {
  const { t } = useTranslation();
  // 取得に失敗した写真。イベントの公開設定が読み込み後に変わると 403/404 に
  // なり得るので、壊れた画像アイコンではなく無地の枠で出す
  // （ポスターなし動画の 404 もここに落ち、再生アイコンだけの枠になる）
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // サーバーも同じ順で返すが、並び順はこの画面の約束なのでここでも保証しておく
  const items = [...photos.photos]
    .sort((a, b) => b.commentCount - a.commentCount)
    .map((p) => ({ id: p.id, kind: p.kind }));
  const rest = Math.max(0, photos.total - items.length);
  if (items.length === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={0.625}
      alignItems="center"
      sx={{ ml: "auto" }}
      aria-label={t("profile.photoStrip")}
    >
      {items.map((item, i) => (
        <ButtonBase
          key={item.id}
          onClick={() => onOpen({ eventId, eventTitle, items, index: i })}
          aria-label={t("profile.photoOpen", { n: i + 1 })}
          sx={{
            width: { xs: 31, sm: 36 },
            height: { xs: 31, sm: 36 },
            flexShrink: 0,
            borderRadius: "9px",
            overflow: "hidden",
            position: "relative",
            bgcolor: "action.hover",
            transition: "transform .14s ease, box-shadow .14s ease",
            "&:hover, &.Mui-focusVisible": {
              transform: "scale(1.14)",
              zIndex: 3,
              boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
            },
          }}
        >
          {!failed.has(item.id) && (
            <Box
              component="img"
              src={eventMediaThumbUrl(eventId, item.id, item.kind)}
              alt=""
              loading="lazy"
              onError={() =>
                setFailed((prev) => new Set(prev).add(item.id))
              }
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
          {item.kind === "video" && (
            <VideoThumbOverlay durationMs={null} small />
          )}
        </ButtonBase>
      ))}
      {rest > 0 && (
        <Box
          component="span"
          title={t("profile.photoMore", { n: rest })}
          sx={{
            width: { xs: 31, sm: 36 },
            height: { xs: 31, sm: 36 },
            flexShrink: 0,
            borderRadius: "9px",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 800,
            color: "text.secondary",
            border: "1px dashed",
            borderColor: "divider",
          }}
        >
          +{rest}
        </Box>
      )}
    </Stack>
  );
}

/** 写真・動画の拡大表示。開くのはクリック/タップのみ（hover では開かない） */
export function TimelinePhotoLightbox({
  open,
  onChange,
  onClose,
}: {
  open: OpenPhoto | null;
  onChange: (p: OpenPhoto) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  const { eventId, eventTitle, items, index } = open;
  const current = items[index];
  const step = (d: number) =>
    onChange({
      ...open,
      index: (index + d + items.length) % items.length,
    });
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      aria-label={t("profile.photoLightbox")}
      // ←→ で前後の写真へ。閉じるは Esc と背景クリック（Dialog 側）と
      // 閉じるボタン。閉じたときのフォーカス戻しも Dialog に任せる
      onKeyDown={(e) => {
        if (items.length < 2) return;
        if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      }}
    >
      <Box sx={{ position: "relative", bgcolor: "#000" }}>
        <IconButton
          onClick={onClose}
          aria-label={t("common.close")}
          sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        {items.length > 1 && (
          <>
            <IconButton
              onClick={() => step(-1)}
              aria-label={t("profile.photoPrev")}
              sx={{
                position: "absolute",
                top: "50%",
                left: 8,
                transform: "translateY(-50%)",
                color: "#fff",
                zIndex: 1,
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              onClick={() => step(1)}
              aria-label={t("profile.photoNext")}
              sx={{
                position: "absolute",
                top: "50%",
                right: 8,
                transform: "translateY(-50%)",
                color: "#fff",
                zIndex: 1,
              }}
            >
              <ChevronRightIcon />
            </IconButton>
          </>
        )}
        {current.kind === "video" ? (
          // 自動再生はしない（controls からの操作のみ #408）
          <Box
            component="video"
            key={current.id}
            controls
            playsInline
            preload="metadata"
            poster={eventMediaPosterUrl(eventId, current.id)}
            src={eventMediaVideoUrl(eventId, current.id)}
            sx={{ display: "block", maxWidth: "90vw", maxHeight: "85vh" }}
          />
        ) : (
          <Box
            component="img"
            src={eventMediaThumbUrl(eventId, current.id, "photo")}
            alt=""
            sx={{
              display: "block",
              maxWidth: "90vw",
              maxHeight: "85vh",
              objectFit: "contain",
            }}
          />
        )}
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            p: 1,
            bgcolor: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Link
            component={RouterLink}
            to={`/events/${eventId}`}
            sx={{ color: "#fff", minWidth: 0 }}
            underline="hover"
            noWrap
          >
            {t("profile.viewEvent", { title: eventTitle })}
          </Link>
          {items.length > 1 && (
            <Typography
              sx={{ color: "#fff", ml: "auto", fontVariantNumeric: "tabular-nums" }}
              variant="body2"
            >
              {index + 1} / {items.length}
            </Typography>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
