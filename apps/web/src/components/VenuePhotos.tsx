import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  IconButton,
  ImageList,
  ImageListItem,
  Stack,
  Typography,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { VENUE_PHOTO_LIMIT, type VenuePhoto } from "@eventer/shared";
import { api } from "../api/client.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";

const photoUrl = (p: VenuePhoto) =>
  `/api/venues/${p.venueId}/photos/${p.id}/image`;

/** 失敗の種類だけを持つ。**訳した文言を state に持たない**（言語を切り替えると
 *  前の言語のまま残るため）。`room` は「あと何点」の数 */
type PhotoError = { kind: "limit" } | { kind: "upload" } | { kind: "room"; room: number };

/** 会場のギャラリー写真（最大10点）。閲覧は公開・投稿/削除はオーナーのみ。
 * アップロード処理はイベント写真と同一（1600pxリサイズ・WebP・1.5MB上限） */
export function VenuePhotos({
  venueId,
  isOwner,
}: {
  venueId: string;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<PhotoError | null>(null);
  const [viewer, setViewer] = useState<VenuePhoto | null>(null);

  const { data } = useQuery({
    queryKey: ["venuePhotos", venueId],
    queryFn: () =>
      api.get<{
        photos: VenuePhoto[];
        pending: VenuePhoto[];
        canSubmit: boolean;
        isOwner: boolean;
        limit: number;
      }>(`/venues/${venueId}/photos`),
  });
  const photos = data?.photos ?? [];
  const pending = data?.pending ?? [];
  const canSubmit = data?.canSubmit ?? false;
  const [submitted, setSubmitted] = useState(false);

  const moderate = useMutation({
    mutationFn: ({ photoId, action }: { photoId: string; action: "approve" | "reject" }) =>
      api.post<{ ok: boolean }>(`/venues/${venueId}/photos/${photoId}/moderate`, {
        action,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["venuePhotos", venueId] }),
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        // イベント写真と同じ前処理を流用
        const encoded = await encodeImageForUpload(file, 1600, 0.8);
        const res = await fetch(`/api/venues/${venueId}/photos`, {
          method: "POST",
          headers: { "Content-Type": encoded.type },
          credentials: "include",
          body: encoded,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "upload_failed");
        }
      }
    },
    onSuccess: () => setSubmitted(true),
    // 途中失敗でもアップロード済み分を一覧へ反映（再選択時の重複を防ぐ）
    onSettled: () => void qc.invalidateQueries({ queryKey: ["venuePhotos", venueId] }),
    onError: (e: Error) =>
      setError(e.message === "photo_limit" ? { kind: "limit" } : { kind: "upload" }),
  });

  const del = useMutation({
    mutationFn: (photoId: string) =>
      api.del<{ ok: boolean }>(`/venues/${venueId}/photos/${photoId}`),
    onSuccess: () => {
      setViewer(null);
      void qc.invalidateQueries({ queryKey: ["venuePhotos", venueId] });
    },
  });

  if (photos.length === 0 && !isOwner && !canSubmit) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <PhotoCameraIcon fontSize="small" />
          {photos.length > 0
            ? t("common.photosHeading", { n: photos.length })
            : t("common.photos")}
        </Typography>
        {(isOwner || canSubmit) && (
          <Button
            size="small"
            startIcon={<AddPhotoAlternateIcon />}
            disabled={
              upload.isPending || (isOwner && photos.length >= VENUE_PHOTO_LIMIT)
            }
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending
              ? t("common.uploading")
              : isOwner
                ? t("venue.photoAddOwner", { n: VENUE_PHOTO_LIMIT })
                : t("venue.photoSubmit")}
          </Button>
        )}
      </Stack>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          setError(null);
          const files = Array.from(e.target.files ?? []);
          const room = isOwner
            ? VENUE_PHOTO_LIMIT - photos.length
            : VENUE_PHOTO_LIMIT - pending.length;
          if (files.length > room) {
            setError({ kind: "room", room });
            return;
          }
          if (files.length > 0) upload.mutate(files);
          e.target.value = "";
        }}
      />
      {error && (
        <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error.kind === "limit"
            ? t("venue.photoLimit", { n: VENUE_PHOTO_LIMIT })
            : error.kind === "upload"
              ? t("venue.photoUploadError")
              : t(error.room === 1 ? "venue.photoRoomOne" : "venue.photoRoom", {
                  n: error.room,
                })}
        </Alert>
      )}
      {submitted && !isOwner && (
        <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSubmitted(false)}>
          {t("venue.photoSubmitted")}
        </Alert>
      )}
      {isOwner && pending.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t("venue.pendingHeading", { n: pending.length })}
          </Typography>
          <Stack spacing={1}>
            {pending.map((p) => (
              <Stack key={p.id} direction="row" flexWrap="wrap" useFlexGap spacing={1.5} alignItems="center">
                <Box
                  component="img"
                  src={photoUrl(p)}
                  alt={t("venue.pendingAlt")}
                  sx={{ width: 96, height: 72, objectFit: "cover", borderRadius: 1, cursor: "pointer" }}
                  onClick={() => setViewer(p)}
                />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {t("venue.pendingBy", {
                    name: p.userName ?? t("role.participant"),
                  })}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={moderate.isPending || photos.length >= VENUE_PHOTO_LIMIT}
                  onClick={() => moderate.mutate({ photoId: p.id, action: "approve" })}
                >
                  {t("venue.photoApprove")}
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={moderate.isPending}
                  onClick={() => {
                    if (window.confirm(t("venue.photoRejectConfirm"))) {
                      moderate.mutate({ photoId: p.id, action: "reject" });
                    }
                  }}
                >
                  {t("venue.photoReject")}
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      {photos.length > 0 && (
        <ImageList cols={3} gap={8} sx={{ mt: 1 }}>
          {photos.map((p) => (
            <ImageListItem
              key={p.id}
              sx={{ cursor: "pointer", borderRadius: 2, overflow: "hidden" }}
              onClick={() => setViewer(p)}
            >
              <img src={photoUrl(p)} alt={t("venue.photoAlt")} loading="lazy" />
            </ImageListItem>
          ))}
        </ImageList>
      )}

      {/* ライトボックス */}
      <Dialog open={Boolean(viewer)} onClose={() => setViewer(null)} maxWidth="lg">
        {viewer && (
          <Box sx={{ position: "relative", bgcolor: "black" }}>
            <img
              src={photoUrl(viewer)}
              alt={t("venue.photoAlt")}
              style={{ display: "block", maxWidth: "100%", maxHeight: "85vh" }}
            />
            <IconButton
              onClick={() => setViewer(null)}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", bgcolor: "rgba(0,0,0,0.4)" }}
              aria-label={t("common.close")}
            >
              <CloseIcon />
            </IconButton>
            {isOwner && (
              <IconButton
                onClick={() => {
                  if (window.confirm(t("common.photoDeleteConfirm"))) {
                    del.mutate(viewer.id);
                  }
                }}
                sx={{ position: "absolute", bottom: 8, right: 8, color: "#fff", bgcolor: "rgba(0,0,0,0.4)" }}
                aria-label={t("common.delete")}
              >
                <DeleteIcon />
              </IconButton>
            )}
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
