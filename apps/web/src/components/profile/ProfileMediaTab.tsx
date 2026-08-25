import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  Link,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { UserPhoto, UserPhotoFacets } from "@eventer/shared";
import { useUserPhotos } from "../../api/eventPhotoHooks.js";
import {
  VideoThumbOverlay,
  eventMediaPosterUrl,
  eventMediaThumbUrl,
  eventMediaVideoUrl,
} from "../videoThumb.js";

/** サムネイル（動画はポスター画像 #408） */
const userPhotoUrl = (p: UserPhoto) =>
  eventMediaThumbUrl(p.eventId, p.id, p.kind);

/** date input の値（ローカル日付）→ その日の始まり/終わりの ms */
const dayStart = (d: string) =>
  d ? new Date(`${d}T00:00:00`).getTime() : undefined;
const dayEnd = (d: string) =>
  d ? new Date(`${d}T23:59:59.999`).getTime() : undefined;

/** メディアタブの絞り込み。すべてコンポーネント state（URL には載せない #407） */
interface MediaFilter {
  eventId: string;
  communityId: string;
  commented: boolean;
  from: string;
  to: string;
}

const NO_FILTER: MediaFilter = {
  eventId: "",
  communityId: "",
  commented: false,
  from: "",
  to: "",
};

const hasFilter = (f: MediaFilter) =>
  Boolean(f.eventId || f.communityId || f.commented || f.from || f.to);

/** 絞り込み行。選択肢はサーバの facets（フィルタ適用前の母集団）から出す */
function MediaFilterRow({
  filter,
  facets,
  onChange,
}: {
  filter: MediaFilter;
  facets: UserPhotoFacets;
  onChange: (next: MediaFilter) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<MediaFilter>) =>
    onChange({ ...filter, ...patch });
  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          select
          label={t("profile.mediaFilterEvent")}
          value={filter.eventId}
          onChange={(e) => set({ eventId: e.target.value })}
          size="small"
          fullWidth
        >
          <MenuItem value="">{t("profile.mediaFilterAll")}</MenuItem>
          {facets.events.map((ev) => (
            <MenuItem key={ev.id} value={ev.id}>
              {ev.title}（{ev.count}）
            </MenuItem>
          ))}
        </TextField>
        {/* コミュニティ未所属のイベントしか無ければ選択肢ごと出さない */}
        {facets.communities.length > 0 && (
          <TextField
            select
            label={t("profile.mediaFilterCommunity")}
            value={filter.communityId}
            onChange={(e) => set({ communityId: e.target.value })}
            size="small"
            fullWidth
          >
            <MenuItem value="">{t("profile.mediaFilterAll")}</MenuItem>
            {facets.communities.map((com) => (
              <MenuItem key={com.id} value={com.id}>
                {com.name}（{com.count}）
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          label={t("profile.mediaFilterFrom")}
          type="date"
          value={filter.from}
          onChange={(e) => set({ from: e.target.value })}
          InputLabelProps={{ shrink: true }}
          size="small"
          fullWidth
        />
        <TextField
          label={t("profile.mediaFilterTo")}
          type="date"
          value={filter.to}
          onChange={(e) => set({ to: e.target.value })}
          InputLabelProps={{ shrink: true }}
          size="small"
          fullWidth
        />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          clickable
          onClick={() => set({ commented: !filter.commented })}
          aria-pressed={filter.commented}
          label={t("profile.mediaFilterCommented")}
          color={filter.commented ? "primary" : "default"}
          variant={filter.commented ? "filled" : "outlined"}
          icon={<ChatBubbleOutlineIcon />}
        />
        {hasFilter(filter) && (
          <Button size="small" onClick={() => onChange(NO_FILTER)}>
            {t("profile.mediaFilterClear")}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * プロフィールの「投稿したメディア」タブ (#407)。
 *
 * 公開イベントに投稿した写真のギャラリー。タブを開いたときに初めて取りに行く
 * （このコンポーネントはタブが選ばれたときだけ描画される）。
 * ページ番号方式のページングと、イベント／コミュニティ／コメントありのみ／期間の
 * 絞り込みを持つ。絞り込みは state のみで URL には載せない。
 * 公開範囲の保証は SQL 側（リポジトリの共通 WHERE）で持ち、ここは表示だけ。
 */
export function ProfileMediaTab({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<MediaFilter>(NO_FILTER);
  const { data } = useUserPhotos(handle, {
    page,
    eventId: filter.eventId || undefined,
    communityId: filter.communityId || undefined,
    commented: filter.commented || undefined,
    from: dayStart(filter.from),
    to: dayEnd(filter.to),
  });
  const [open, setOpen] = useState<UserPhoto | null>(null);
  if (!data) return null;

  // 1枚も投稿が無いのか、絞り込みで0件なのかは別のこと。絞り込み中は
  // フィルタ行を残さないと条件を外せなくなる
  if (data.total === 0 && !hasFilter(filter)) {
    return (
      <Typography color="text.secondary">
        {t("profile.tabEmptyMedia")}
      </Typography>
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit));

  const changeFilter = (next: MediaFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <PhotoCameraIcon fontSize="small" />
        {t("profile.photosHeading", { n: data.total })}
      </Typography>

      <MediaFilterRow
        filter={filter}
        facets={data.facets}
        onChange={changeFilter}
      />

      {data.photos.length === 0 ? (
        <Typography color="text.secondary">
          {t("profile.mediaFilterNoMatch")}
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(3, 1fr)",
              sm: "repeat(4, 1fr)",
              md: "repeat(6, 1fr)",
            },
            gap: 0.75,
          }}
        >
          {data.photos.map((p) => (
            <Box
              key={p.id}
              onClick={() => setOpen(p)}
              sx={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: 1,
                overflow: "hidden",
                cursor: "pointer",
                bgcolor: "action.hover",
              }}
            >
              <Box
                component="img"
                src={userPhotoUrl(p)}
                alt=""
                loading="lazy"
                onError={
                  p.kind === "video"
                    ? (e) => {
                        // ポスターなし動画はグレー地＋再生アイコンをプレースホルダに
                        e.currentTarget.style.display = "none";
                      }
                    : undefined
                }
                sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {p.kind === "video" && <VideoThumbOverlay durationMs={p.durationMs} />}
              {p.commentCount > 0 && (
                <Stack
                  direction="row"
                  spacing={0.25}
                  alignItems="center"
                  sx={{
                    position: "absolute",
                    top: 2,
                    left: 2,
                    px: 0.5,
                    borderRadius: 1,
                    bgcolor: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    pointerEvents: "none",
                  }}
                >
                  <ChatBubbleOutlineIcon sx={{ fontSize: 12 }} />
                  <Typography sx={{ fontSize: 11, lineHeight: 1.6 }}>
                    {p.commentCount}
                  </Typography>
                </Stack>
              )}
            </Box>
          ))}
        </Box>
      )}

      {pageCount > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_e, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}

      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} maxWidth="lg">
        {open && (
          <Box sx={{ position: "relative", bgcolor: "#000" }}>
            <IconButton
              onClick={() => setOpen(null)}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            {open.kind === "video" ? (
              // 自動再生はしない（controls からの操作のみ #408）
              <Box
                component="video"
                controls
                playsInline
                preload="metadata"
                poster={eventMediaPosterUrl(open.eventId, open.id)}
                src={eventMediaVideoUrl(open.eventId, open.id)}
                sx={{ display: "block", maxWidth: "90vw", maxHeight: "85vh" }}
              />
            ) : (
              <Box
                component="img"
                src={userPhotoUrl(open)}
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
              }}
            >
              <Link
                component={RouterLink}
                to={`/events/${open.eventId}`}
                sx={{ color: "#fff" }}
                underline="hover"
              >
                {t("profile.viewEvent", { title: open.eventTitle })}
              </Link>
            </Box>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
