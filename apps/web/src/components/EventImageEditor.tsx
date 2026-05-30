import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { EVENT_IMAGE } from "@eventer/shared";
import {
  eventImageUrl,
  useDeleteEventImage,
  useUploadEventImage,
} from "../api/hooks.js";
import { ImageCropField } from "./ImageCropField.js";

export function EventImageEditor({
  event,
}: {
  event: { id: string; imageUpdatedAt: number | null };
}) {
  const upload = useUploadEventImage(event.id);
  const remove = useDeleteEventImage(event.id);
  const currentUrl = eventImageUrl(event);

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        イベント画像（OG画像 {EVENT_IMAGE.width}×{EVENT_IMAGE.height}）
      </Typography>

      {currentUrl ? (
        <Box
          component="img"
          src={currentUrl}
          alt="event"
          sx={{
            width: "100%",
            maxWidth: 480,
            aspectRatio: `${EVENT_IMAGE.width} / ${EVENT_IMAGE.height}`,
            objectFit: "cover",
            borderRadius: 1,
            display: "block",
            mb: 1,
          }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          画像は未設定です
        </Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <ImageCropField
          label={currentUrl ? "画像を変更" : "画像を追加"}
          busy={upload.isPending}
          onCropped={(blob) => upload.mutate(blob)}
        />
        {currentUrl && (
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            削除
          </Button>
        )}
      </Stack>
      {upload.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          アップロードに失敗しました（1MB以内の画像）
        </Alert>
      )}
    </Box>
  );
}
