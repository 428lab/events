import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
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
  Typography,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SendIcon from "@mui/icons-material/Send";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
import { CounterTextField } from "./CounterTextField.js";
import { encodeImageForUpload } from "../lib/encodeImage.js";
import { formatDateTime } from "../lib/format.js";
import {
  VideoThumbOverlay,
  eventMediaPosterUrl,
  eventMediaThumbUrl,
  eventMediaVideoUrl,
} from "./videoThumb.js";

const photoUrl = (eventId: string, photoId: string) =>
  `/api/events/${eventId}/photos/${photoId}/image`;

/** 動画の投稿フロー (#408)。変換ライブラリ（mediabunny）が大きいので、
 * 動画を選んだときだけ遅延読み込みする */
const VideoUploadDialog = lazy(() =>
  import("./VideoUploadDialog.js").then((m) => ({
    default: m.VideoUploadDialog,
  })),
);
// 型だけの import はチャンク分割に影響しない
import type { VideoUploadOutcome } from "./VideoUploadDialog.js";

/** 動画かどうか (#408)。複数選ばれたらキューで1本ずつ処理する (#427) */
const isVideoFile = (f: File) =>
  f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name);

/** 動画キュー (#427)。files[0] が処理中の1本。total は今回の一連の本数で、
 * 「N本中M本目」の分母（M = total - files.length + 1） */
interface VideoQueue {
  files: File[];
  total: number;
  uploaded: number;
  failed: number;
}

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
  const { t } = useTranslation();
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
  const [videoQueue, setVideoQueue] = useState<VideoQueue | null>(null);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      // 動画 (#408) は専用フロー（変換＋進捗ダイアログ）へ。複数本は
      // キューに積んで1本ずつ順に処理する（並行変換はしない #427）
      const videos = files.filter(isVideoFile);
      if (videos.length > 0) {
        setVideoQueue((prev) =>
          prev
            ? {
                ...prev,
                files: [...prev.files, ...videos],
                total: prev.total + videos.length,
              }
            : { files: videos, total: videos.length, uploaded: 0, failed: 0 },
        );
      }
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
            ? t("eventSocial.photoLimit", { n: EVENT_PHOTO_LIMIT })
            : t("eventSocial.photoUploadFailed"),
        );
      } finally {
        setUploading(0);
      }
    },
    [upload, t],
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

  /** 動画キューの1本が終わった (#427)。結果を数えて次の1本へ。
   * 50枠切れ（limit）は以降も同じ結果になるので残りを中止する */
  const handleVideoDone = (outcome: VideoUploadOutcome) => {
    if (!videoQueue) return;
    const uploaded = videoQueue.uploaded + (outcome === "uploaded" ? 1 : 0);
    const failed = videoQueue.failed + (outcome === "failed" ? 1 : 0);
    const rest =
      outcome === "cancelAll" || outcome === "limit"
        ? []
        : videoQueue.files.slice(1);
    if (outcome === "limit") {
      setError(t("eventSocial.photoLimit", { n: EVENT_PHOTO_LIMIT }));
    } else if (rest.length === 0 && failed > 0) {
      // 最後に結果が分かるように、失敗があったときだけまとめを出す
      setError(t("eventSocial.videoQueueSummary", { ok: uploaded, ng: failed }));
    }
    setVideoQueue(
      rest.length === 0
        ? null
        : { files: rest, total: videoQueue.total, uploaded, failed },
    );
  };

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
          <Typography
            variant="h6"
            sx={{
              flex: 1,
              minWidth: 120,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <PhotoCameraIcon fontSize="small" />
            {t("common.photosHeading", { n: photos?.length ?? 0 })}
          </Typography>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
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
              {uploading > 0
                ? t("eventSocial.photoUploading", { n: uploading })
                : t("eventSocial.photoAdd")}
            </Button>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {photosPublic
            ? t("eventSocial.photosPublicNotice")
            : t("eventSocial.photosMembersNotice")}
          {isMember && t("eventSocial.photosDropHint")}
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
            label={t("eventSocial.photosPublicToggle")}
          />
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!photos || photos.length === 0 ? (
          <Typography color="text.secondary">
            {t("eventSocial.photosEmpty")}
            {isMember && t("eventSocial.photosEmptyHint")}
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
                  src={eventMediaThumbUrl(eventId, p.id, p.kind)}
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
                {p.kind === "video" && (
                  <VideoThumbOverlay durationMs={p.durationMs} />
                )}
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
                    aria-label={t("eventSocial.photoDelete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(t("common.photoDeleteConfirm")))
                        del.mutate(p.id);
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
          if (window.confirm(t("common.photoDeleteConfirm"))) {
            del.mutate(id);
            setLightbox(null);
          }
        }}
      />

      {/* 動画の変換＋アップロード (#408)。選ばれたときだけ読み込む。
          複数本はキューで1本ずつ (#427)。key で本ごとにマウントし直す
          （ダイアログは1ファイル1回のフローを前提に作られている） */}
      {videoQueue && videoQueue.files[0] && (
        <Suspense fallback={null}>
          <VideoUploadDialog
            key={videoQueue.total - videoQueue.files.length}
            eventId={eventId}
            file={videoQueue.files[0]}
            queue={{
              index: videoQueue.total - videoQueue.files.length + 1,
              total: videoQueue.total,
            }}
            onClose={handleVideoDone}
          />
        </Suspense>
      )}
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
  const { t } = useTranslation();
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
            ? t("eventSocial.photoCommentLimit", { n: PHOTO_COMMENT_LIMIT })
            : t("eventSocial.commentPostFailed"),
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
              aria-label={t("common.close")}
              sx={{ position: "absolute", top: 8, right: 8, color: "#fff", zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            {photo.kind === "video" ? (
              // 自動再生はしない（controls からの操作のみ）
              <Box
                component="video"
                controls
                playsInline
                preload="metadata"
                poster={eventMediaPosterUrl(eventId, photo.id)}
                src={eventMediaVideoUrl(eventId, photo.id)}
                sx={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: { xs: "50vh", md: "85vh" },
                }}
              />
            ) : (
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
            )}
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
                  title={t("eventSocial.photoDelete")}
                  aria-label={t("eventSocial.photoDelete")}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>

            {/* コメント一覧 */}
            <Stack spacing={1.5} sx={{ p: 1.5, flex: 1, overflowY: "auto" }}>
              {!comments ? (
                <Typography variant="caption" color="text.secondary">
                  {t("common.loading")}
                </Typography>
              ) : comments.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {t("eventSocial.commentsEmpty")}
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
                        aria-label={t("eventSocial.photoCommentDelete")}
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
                <CounterTextField
                  size="small"
                  fullWidth
                  multiline
                  maxRows={4}
                  placeholder={t("eventSocial.photoCommentPlaceholder")}
                  value={body}
                  max={200}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                  }}
                />
                <IconButton
                  color="primary"
                  disabled={!body.trim() || addComment.isPending}
                  onClick={submit}
                  aria-label={t("common.send")}
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
                {t("eventSocial.photoCommentMembersOnly")}
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Dialog>
  );
}
