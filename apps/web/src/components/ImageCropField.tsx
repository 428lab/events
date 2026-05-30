import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import {
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
import { cropToOgImage, type PixelCrop } from "../lib/cropImage.js";

/**
 * 画像をピックして OG サイズ(1200x630)にクロップし、Blob を onCropped で返す。
 * アップロードは行わない（呼び出し側が即アップロード/遅延アップロードを選べる）。
 */
export function ImageCropField({
  label,
  busy,
  onCropped,
}: {
  label: string;
  busy?: boolean;
  onCropped: (blob: Blob) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<PixelCrop | null>(null);
  const [working, setWorking] = useState(false);

  const onCropComplete = useCallback((_a: unknown, px: PixelCrop) => {
    setAreaPixels(px);
  }, []);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSrc(URL.createObjectURL(file));
    e.target.value = "";
  };

  const close = () => {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setAreaPixels(null);
  };

  const save = async () => {
    if (!src || !areaPixels) return;
    setWorking(true);
    try {
      const blob = await cropToOgImage(src, areaPixels);
      onCropped(blob);
      close();
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={pickFile}
      />

      <Dialog open={Boolean(src)} onClose={close} maxWidth="sm" fullWidth>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>キャンセル</Button>
          <Button
            variant="contained"
            disabled={working || !areaPixels}
            onClick={save}
          >
            適用
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
