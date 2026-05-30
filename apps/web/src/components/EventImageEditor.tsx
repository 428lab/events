import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import { EVENT_IMAGE } from "@eventer/shared";
import {
  eventImageUrl,
  useDeleteEventImage,
  useUploadEventImage,
} from "../api/hooks.js";
import { cropToOgImage, type PixelCrop } from "../lib/cropImage.js";

export function EventImageEditor({
  event,
}: {
  event: { id: string; imageUpdatedAt: number | null };
}) {
  const upload = useUploadEventImage(event.id);
  const remove = useDeleteEventImage(event.id);
  const fileRef = useRef<HTMLInputElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<PixelCrop | null>(null);

  const onCropComplete = useCallback((_a: unknown, px: PixelCrop) => {
    setAreaPixels(px);
  }, []);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSrc(URL.createObjectURL(file));
    e.target.value = "";
  };

  const closeDialog = () => {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };

  const save = async () => {
    if (!src || !areaPixels) return;
    const blob = await cropToOgImage(src, areaPixels);
    upload.mutate(blob, { onSuccess: closeDialog });
  };

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

      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={() => fileRef.current?.click()}>
          {currentUrl ? "画像を変更" : "画像を追加"}
        </Button>
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={pickFile}
      />

      <Dialog open={Boolean(src)} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>クロップ範囲を指定</DialogTitle>
        <DialogContent>
          <Box
            sx={{
              position: "relative",
              width: "100%",
              height: 320,
              bgcolor: "grey.900",
            }}
          >
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={EVENT_IMAGE.width / EVENT_IMAGE.height}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </Box>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
            <Typography variant="body2">ズーム</Typography>
            <Slider
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(_e, v) => setZoom(v as number)}
            />
          </Stack>
          {upload.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              アップロードに失敗しました
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>キャンセル</Button>
          <Button
            variant="contained"
            disabled={upload.isPending || !areaPixels}
            onClick={save}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
