import { useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Stack, Typography } from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { EVENT_DESCRIPTION_IMAGE, type EventDescriptionImage } from "@eventer/shared";
import {
  useDeleteEventDescriptionImage,
  useEventDescriptionImages,
  useUploadEventDescriptionImage,
} from "../api/descriptionImageHooks.js";
import { imageMarkdown, resizeForDescription } from "../lib/descriptionImages.js";
import { errorMessage } from "../lib/errorMessage.js";

/**
 * 説明文・参加者限定文章の下に出す画像トレイ (D-DESC-IMAGE)。
 *
 * 画像はイベントごとに1つの置き場（最大10枚）で、どちらの入力欄のトレイにも
 * 同じ一覧が出る。サムネイルを押すと**その入力欄**のカーソル位置に `![](url)` を
 * 差し込む。× は確認のうえ画像を消し、`onRemoved` で両方の入力欄から参照を外す
 * （保存はいつもどおり利用者が行う）。
 */
export function DescriptionImageTray({
  eventId,
  onInsert,
  onRemoved,
}: {
  eventId: string;
  onInsert: (markdown: string) => void;
  onRemoved: (image: EventDescriptionImage) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { data: images = [] } = useEventDescriptionImages(eventId);
  const upload = useUploadEventDescriptionImage(eventId);
  const remove = useDeleteEventDescriptionImage(eventId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = EVENT_DESCRIPTION_IMAGE.maxPerEvent;
  const full = images.length >= max;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await resizeForDescription(file);
      await upload.mutateAsync(blob);
    } catch (err) {
      setError(
        errorMessage(err, {
          limit_reached: t("eventForm.descriptionImageLimit", { max }),
          default: t("eventForm.descriptionImageUploadFailed"),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const del = (image: EventDescriptionImage) => {
    if (!window.confirm(t("eventForm.descriptionImageDeleteConfirm"))) return;
    setError(null);
    remove.mutate(image.id, {
      onSuccess: () => onRemoved(image),
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Box sx={{ mt: 1 }} data-testid="description-image-tray">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddPhotoAlternateIcon />}
          disabled={full || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? t("eventForm.descriptionImageUploading") : t("eventForm.descriptionImageAdd")}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {images.length}/{max}
        </Typography>
        <input
          ref={input}
          type="file"
          hidden
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void pick(file);
          }}
        />
      </Stack>
      {images.length > 0 && (
        <>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              overflowX: "auto",
              // × バッジがはみ出す分の余白
              pt: 1,
              pr: 1,
              pb: 0.5,
            }}
          >
            {images.map((image) => (
              <Box key={image.id} sx={{ position: "relative", flexShrink: 0 }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => onInsert(imageMarkdown(image.url))}
                  aria-label={t("eventForm.descriptionImageInsert")}
                  title={t("eventForm.descriptionImageInsert")}
                  sx={{
                    display: "block",
                    p: 0,
                    width: 72,
                    height: 72,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    overflow: "hidden",
                    cursor: "pointer",
                    bgcolor: "action.hover",
                  }}
                >
                  <Box
                    component="img"
                    src={image.url}
                    alt=""
                    loading="lazy"
                    sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </Box>
                <IconButton
                  size="small"
                  onClick={() => del(image)}
                  aria-label={t("eventForm.descriptionImageDelete")}
                  disabled={remove.isPending}
                  sx={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 24,
                    height: 24,
                    bgcolor: "background.paper",
                    border: "1px solid",
                    borderColor: "divider",
                    "&:hover": { bgcolor: "background.paper" },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t("eventForm.descriptionImageTapHint")}
          </Typography>
        </>
      )}
      {full && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("eventForm.descriptionImageLimit", { max })}
        </Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
