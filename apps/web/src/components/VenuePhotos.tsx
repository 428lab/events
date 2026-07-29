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
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VENUE_PHOTO_LIMIT, type VenuePhoto } from "@eventer/shared";
import { api } from "../api/client.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";

const photoUrl = (p: VenuePhoto) =>
  `/api/venues/${p.venueId}/photos/${p.id}/image`;

/** 会場のギャラリー写真（最大10点）。閲覧は公開・投稿/削除はオーナーのみ。
 * アップロード処理はイベント写真と同一（1600pxリサイズ・WebP・1.5MB上限） */
export function VenuePhotos({
  venueId,
  isOwner,
}: {
  venueId: string;
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<VenuePhoto | null>(null);

  const { data } = useQuery({
    queryKey: ["venuePhotos", venueId],
    queryFn: () =>
      api.get<{ photos: VenuePhoto[]; limit: number }>(
        `/venues/${venueId}/photos`,
      ),
  });
  const photos = data?.photos ?? [];

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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["venuePhotos", venueId] }),
    onError: (e: Error) =>
      setError(
        e.message === "photo_limit"
          ? `写真は最大 ${VENUE_PHOTO_LIMIT} 点までです。`
          : "アップロードに失敗しました。画像形式・サイズを確認してください。",
      ),
  });

  const del = useMutation({
    mutationFn: (photoId: string) =>
      api.del<{ ok: boolean }>(`/venues/${venueId}/photos/${photoId}`),
    onSuccess: () => {
      setViewer(null);
      void qc.invalidateQueries({ queryKey: ["venuePhotos", venueId] });
    },
  });

  if (photos.length === 0 && !isOwner) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6">
          📷 写真{photos.length > 0 ? `（${photos.length}）` : ""}
        </Typography>
        {isOwner && (
          <Button
            size="small"
            startIcon={<AddPhotoAlternateIcon />}
            disabled={upload.isPending || photos.length >= VENUE_PHOTO_LIMIT}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending
              ? "アップロード中…"
              : `写真を追加（最大${VENUE_PHOTO_LIMIT}点）`}
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
          const room = VENUE_PHOTO_LIMIT - photos.length;
          if (files.length > room) {
            setError(`あと ${room} 点まで追加できます。`);
            return;
          }
          if (files.length > 0) upload.mutate(files);
          e.target.value = "";
        }}
      />
      {error && (
        <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {photos.length > 0 && (
        <ImageList cols={3} gap={8} sx={{ mt: 1 }}>
          {photos.map((p) => (
            <ImageListItem
              key={p.id}
              sx={{ cursor: "pointer", borderRadius: 2, overflow: "hidden" }}
              onClick={() => setViewer(p)}
            >
              <img src={photoUrl(p)} alt="会場写真" loading="lazy" />
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
              alt="会場写真"
              style={{ display: "block", maxWidth: "100%", maxHeight: "85vh" }}
            />
            <IconButton
              onClick={() => setViewer(null)}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", bgcolor: "rgba(0,0,0,0.4)" }}
              aria-label="閉じる"
            >
              <CloseIcon />
            </IconButton>
            {isOwner && (
              <IconButton
                onClick={() => {
                  if (window.confirm("この写真を削除しますか？")) {
                    del.mutate(viewer.id);
                  }
                }}
                sx={{ position: "absolute", bottom: 8, right: 8, color: "#fff", bgcolor: "rgba(0,0,0,0.4)" }}
                aria-label="削除"
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
