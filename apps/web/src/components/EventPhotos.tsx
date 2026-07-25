import { useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import type { EventPhoto, EventRole } from "@eventer/shared";
import { EVENT_PHOTO_LIMIT } from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useDeleteEventPhoto,
  useEventPhotos,
  useUploadEventPhoto,
} from "../api/eventPhotoHooks.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";

const photoUrl = (eventId: string, photoId: string) =>
  `/api/events/${eventId}/photos/${photoId}/image`;

/** イベントフォトギャラリー（参加者のみ表示・アップロード） */
export function EventPhotos({
  eventId,
  myRole,
  isAdmin,
}: {
  eventId: string;
  myRole: EventRole | null;
  isAdmin: boolean;
}) {
  const { data: me } = useMe();
  const isMember = Boolean(myRole);
  const isStaff = myRole === "staff" || isAdmin;
  const { data: photos } = useEventPhotos(eventId, isMember);
  const upload = useUploadEventPhoto(eventId);
  const del = useDeleteEventPhoto(eventId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<EventPhoto | null>(null);
  const [uploading, setUploading] = useState(0);

  // 非参加者には出さない（参加者限定の写真プライバシー）
  if (!isMember) return null;

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    setUploading(files.length);
    try {
      for (const file of files) {
        const encoded = await encodeImageForUpload(file, 2048, 0.85);
        await upload.mutateAsync(encoded);
        setUploading((n) => n - 1);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === "photo_limit"
          ? `写真は1イベント${EVENT_PHOTO_LIMIT}枚までです。`
          : "アップロードに失敗しました。",
      );
    } finally {
      setUploading(0);
    }
  };

  const canDelete = (p: EventPhoto) => p.userId === me?.id || isStaff;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ mb: 1.5 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="h6" sx={{ flex: 1, minWidth: 120 }}>
            📷 写真（{photos?.length ?? 0}）
          </Typography>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onFiles}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<PhotoCameraIcon />}
            disabled={uploading > 0}
            onClick={() => fileRef.current?.click()}
          >
            {uploading > 0 ? `アップロード中… 残り${uploading}` : "写真を追加"}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          このイベントの参加者だけが見られます。複数選択できます。
        </Typography>

        {error && (
          <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!photos || photos.length === 0 ? (
          <Typography color="text.secondary">
            まだ写真がありません。「写真を追加」から共有しましょう。
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(3, 1fr)",
                sm: "repeat(4, 1fr)",
                md: "repeat(5, 1fr)",
              },
              gap: 0.75,
            }}
          >
            {photos.map((p) => (
              <Box
                key={p.id}
                onClick={() => setLightbox(p)}
                sx={{
                  position: "relative",
                  aspectRatio: "1",
                  borderRadius: 1,
                  overflow: "hidden",
                  cursor: "pointer",
                  bgcolor: "action.hover",
                  "&:hover .photo-del": { opacity: 1 },
                }}
              >
                <Box
                  component="img"
                  src={photoUrl(eventId, p.id)}
                  alt=""
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                {/* 投稿者（アイコン＋名前） */}
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    px: 0.5,
                    py: 0.25,
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))",
                    pointerEvents: "none",
                  }}
                >
                  <Avatar
                    src={p.userAvatarUrl ?? undefined}
                    sx={{ width: 16, height: 16, fontSize: 9 }}
                  >
                    {p.userName.charAt(0)}
                  </Avatar>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ color: "#fff", fontSize: 11, minWidth: 0 }}
                  >
                    {p.userName}
                  </Typography>
                </Stack>
                {canDelete(p) && (
                  <IconButton
                    className="photo-del"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("この写真を削除しますか？")) del.mutate(p.id);
                    }}
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      bgcolor: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      opacity: { xs: 1, md: 0 },
                      transition: "opacity .15s",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.75)" },
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        )}
      </CardContent>

      {/* ライトボックス */}
      <Dialog open={Boolean(lightbox)} onClose={() => setLightbox(null)} maxWidth="lg">
        {lightbox && (
          <Box sx={{ position: "relative", bgcolor: "#000" }}>
            <IconButton
              onClick={() => setLightbox(null)}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            <Box
              component="img"
              src={photoUrl(eventId, lightbox.id)}
              alt=""
              sx={{
                display: "block",
                maxWidth: "90vw",
                maxHeight: "85vh",
                objectFit: "contain",
              }}
            />
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                p: 1,
                bgcolor: "rgba(0,0,0,0.5)",
              }}
            >
              <Avatar src={lightbox.userAvatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
                {lightbox.userName.charAt(0)}
              </Avatar>
              <Typography variant="body2" sx={{ color: "#fff", flex: 1 }}>
                {lightbox.userName}
              </Typography>
              {canDelete(lightbox) && (
                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => {
                    if (window.confirm("この写真を削除しますか？")) {
                      del.mutate(lightbox.id);
                      setLightbox(null);
                    }
                  }}
                >
                  削除
                </Button>
              )}
            </Stack>
          </Box>
        )}
      </Dialog>
    </Card>
  );
}
