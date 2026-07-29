import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SendIcon from "@mui/icons-material/Send";
import { Link as RouterLink } from "react-router-dom";
import type { EventPhoto, EventRole } from "@eventer/shared";
import { EVENT_PHOTO_LIMIT, PHOTO_COMMENT_LIMIT } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { useMe, useUpdateEvent } from "../api/hooks.js";
import {
  useAddPhotoComment,
  useDeleteEventPhoto,
  useDeletePhotoComment,
  useEventPhotos,
  usePhotoComments,
  useUploadEventPhoto,
} from "../api/eventPhotoHooks.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";
import { formatDateTime } from "../lib/format.js";

const photoUrl = (eventId: string, photoId: string) =>
  `/api/events/${eventId}/photos/${photoId}/image`;

/** イベントフォトギャラリー（参加者は常に、公開設定時は誰でも閲覧） */
export function EventPhotos({
  eventId,
  myRole,
  photosPublic,
  published,
}: {
  eventId: string;
  myRole: EventRole | null;
  photosPublic: boolean;
  published: boolean;
}) {
  const { data: me } = useMe();
  const isMember = Boolean(myRole);
  // イベント配下のUIは myRole のみで判定（サイト管理者でもイベントスタッフでなければ操作UIを出さない）
  const isStaff = myRole === "staff";
  // 公開設定なら誰でも閲覧、そうでなければ参加者のみ
  const canView = isMember || (photosPublic && published);
  const { data: photos } = useEventPhotos(eventId, canView);
  const upload = useUploadEventPhoto(eventId);
  const del = useDeleteEventPhoto(eventId);
  const updateEvent = useUpdateEvent(eventId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<EventPhoto | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      setError(null);
      setUploading(images.length);
      try {
        for (const file of images) {
          // 長辺1600px・WebP画質0.8に縮小（容量削減。典型 ~250KB）
          const encoded = await encodeImageForUpload(file, 1600, 0.8);
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
    },
    [upload],
  );

  // クリップボードから貼り付けてアップロード（メンバーのみ・ライトボックスを開いていない時）
  useEffect(() => {
    if (!isMember) return;
    const onPaste = (e: ClipboardEvent) => {
      if (lightbox) return;
      const files = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (files.length > 0) {
        e.preventDefault();
        void uploadFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isMember, lightbox, uploadFiles]);

  // 閲覧権限がなく、写真もない（＝出す理由がない）なら非表示
  if (!canView) return null;

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    void uploadFiles(files);
  };

  const canDelete = (p: EventPhoto) => p.userId === me?.id || isStaff;

  return (
    <Card variant="outlined">
      <CardContent
        onDragEnter={
          isMember
            ? (e) => {
                e.preventDefault();
                setDragOver(true);
              }
            : undefined
        }
        onDragOver={isMember ? (e) => e.preventDefault() : undefined}
        onDragLeave={
          isMember
            ? (e) => {
                if (e.currentTarget === e.target) setDragOver(false);
              }
            : undefined
        }
        onDrop={
          isMember
            ? (e) => {
                e.preventDefault();
                setDragOver(false);
                void uploadFiles([...e.dataTransfer.files]);
              }
            : undefined
        }
        sx={
          dragOver
            ? { outline: "2px dashed", outlineColor: "primary.main", outlineOffset: -4 }
            : undefined
        }
      >
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
            onChange={onFileInput}
          />
          {isMember && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PhotoCameraIcon />}
              disabled={uploading > 0}
              onClick={() => fileRef.current?.click()}
            >
              {uploading > 0 ? `アップロード中… 残り${uploading}` : "写真を追加"}
            </Button>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {photosPublic
            ? "この写真は誰でも見られます。"
            : "このイベントの参加者だけが見られます。"}
          {isMember && " ドラッグ&ドロップや貼り付け（Ctrl/⌘+V）でも追加できます。"}
        </Typography>

        {isStaff && (
          <FormControlLabel
            sx={{ mb: 1 }}
            control={
              <Switch
                checked={photosPublic}
                disabled={updateEvent.isPending}
                onChange={(e) =>
                  updateEvent.mutate({ photosPublic: e.target.checked })
                }
              />
            }
            label="参加者以外にも写真を公開する"
          />
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!photos || photos.length === 0 ? (
          <Typography color="text.secondary">
            まだ写真がありません。
            {isMember && "「写真を追加」やドラッグ&ドロップで共有しましょう。"}
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
                {/* コメント数バッジ */}
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

      <PhotoLightbox
        eventId={eventId}
        photo={lightbox}
        onClose={() => setLightbox(null)}
        canComment={isMember}
        isStaff={isStaff}
        canDeletePhoto={lightbox ? canDelete(lightbox) : false}
        onDeletePhoto={(id) => {
          if (window.confirm("この写真を削除しますか？")) {
            del.mutate(id);
            setLightbox(null);
          }
        }}
      />
    </Card>
  );
}

/** 写真の拡大表示＋コメント */
function PhotoLightbox({
  eventId,
  photo,
  onClose,
  canComment,
  isStaff,
  canDeletePhoto,
  onDeletePhoto,
}: {
  eventId: string;
  photo: EventPhoto | null;
  onClose: () => void;
  canComment: boolean;
  isStaff: boolean;
  canDeletePhoto: boolean;
  onDeletePhoto: (id: string) => void;
}) {
  const { data: me } = useMe();
  const photoId = photo?.id ?? "";
  const { data: comments } = usePhotoComments(eventId, photoId, Boolean(photo));
  const addComment = useAddPhotoComment(eventId, photoId);
  const delComment = useDeletePhotoComment(eventId, photoId);
  const [body, setBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setCommentError(null);
    addComment.mutate(text, {
      onSuccess: () => setBody(""),
      onError: (err) =>
        setCommentError(
          err instanceof ApiError && err.status === 409
            ? `コメントは1枚につき${PHOTO_COMMENT_LIMIT}件までです。`
            : "コメントの投稿に失敗しました。",
        ),
    });
  };

  return (
    <Dialog open={Boolean(photo)} onClose={onClose} maxWidth="lg" fullWidth>
      {photo && (
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            bgcolor: "background.paper",
            maxHeight: { md: "85vh" },
          }}
        >
          {/* 画像 */}
          <Box
            sx={{
              position: "relative",
              bgcolor: "#000",
              flex: { md: "1 1 60%" },
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 200,
            }}
          >
            <IconButton
              onClick={onClose}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            <Box
              component="img"
              src={photoUrl(eventId, photo.id)}
              alt=""
              sx={{
                display: "block",
                maxWidth: "100%",
                maxHeight: { xs: "50vh", md: "85vh" },
                objectFit: "contain",
              }}
            />
          </Box>

          {/* コメント欄 */}
          <Stack
            sx={{
              flex: { md: "0 0 320px" },
              width: { md: 320 },
              maxHeight: { xs: "40vh", md: "85vh" },
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Avatar src={photo.userAvatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                {photo.userName.charAt(0)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {photo.userName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(photo.createdAt)}
                </Typography>
              </Box>
              {canDeletePhoto && (
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onDeletePhoto(photo.id)}
                  title="写真を削除"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>

            {/* コメント一覧 */}
            <Stack spacing={1.5} sx={{ p: 1.5, flex: 1, overflowY: "auto" }}>
              {!comments ? (
                <Typography variant="caption" color="text.secondary">
                  読み込み中…
                </Typography>
              ) : comments.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  まだコメントはありません。
                </Typography>
              ) : (
                comments.map((c) => (
                  <Stack key={c.id} direction="row" spacing={1} alignItems="flex-start">
                    <Avatar
                      src={c.userAvatarUrl ?? undefined}
                      component={c.username ? RouterLink : "div"}
                      to={c.username ? `/users/${c.username}` : undefined}
                      sx={{ width: 24, height: 24, fontSize: 12, textDecoration: "none" }}
                    >
                      {c.userName.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="baseline" flexWrap="wrap">
                        <Typography variant="caption" fontWeight={600}>
                          {c.userName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(c.createdAt)}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {c.body}
                      </Typography>
                    </Box>
                    {(c.userId === me?.id || isStaff) && (
                      <IconButton
                        size="small"
                        onClick={() => delComment.mutate(c.id)}
                        sx={{ mt: -0.5 }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    )}
                  </Stack>
                ))
              )}
            </Stack>

            {/* 入力 */}
            {canComment ? (
              <Box sx={{ borderTop: 1, borderColor: "divider" }}>
              {commentError && (
                <Alert severity="warning" sx={{ mx: 1.5, mt: 1.5 }} onClose={() => setCommentError(null)}>
                  {commentError}
                </Alert>
              )}
              <Stack
                direction="row"
                spacing={1}
                sx={{ p: 1.5 }}
              >
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  maxRows={4}
                  placeholder="コメントを追加…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                  }}
                />
                <IconButton
                  color="primary"
                  disabled={!body.trim() || addComment.isPending}
                  onClick={submit}
                >
                  <SendIcon />
                </IconButton>
              </Stack>
              </Box>
            ) : (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}
              >
                コメントするにはこのイベントの参加者である必要があります。
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Dialog>
  );
}
