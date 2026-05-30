import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { EVENT_IMAGE, VENUE_TYPES, type VenueType } from "@eventer/shared";
import { useCreateEvent } from "../api/hooks.js";
import { ImageCropField } from "../components/ImageCropField.js";
import { venueLabel } from "../lib/format.js";

function toEpoch(local: string): number {
  return new Date(local).getTime();
}

export function CreateEventPage() {
  const navigate = useNavigate();
  const createEvent = useCreateEvent();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const setCropped = (blob: Blob) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(blob);
    setImagePreview(URL.createObjectURL(blob));
  };
  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(null);
    setImagePreview(null);
  };

  const canSubmit = title && startsAt && endsAt;

  const submit = () => {
    createEvent.mutate(
      {
        title,
        description,
        startsAt: toEpoch(startsAt),
        endsAt: toEpoch(endsAt),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        aggregateSelfEntry: false,
      },
      {
        onSuccess: async ({ event }) => {
          if (imageBlob) {
            await fetch(`/api/events/${event.id}/image`, {
              method: "PUT",
              headers: { "Content-Type": imageBlob.type },
              credentials: "include",
              body: imageBlob,
            }).catch(() => undefined);
          }
          navigate(`/events/${event.id}`);
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          イベント作成
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          <TextField
            label="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="内容"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="開始日時"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="終了日時"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
          <TextField
            label="会場種別"
            select
            value={venueType}
            onChange={(e) => setVenueType(e.target.value as VenueType)}
            fullWidth
          >
            {VENUE_TYPES.map((v) => (
              <MenuItem key={v} value={v}>
                {venueLabel[v]}
              </MenuItem>
            ))}
          </TextField>
          {venueType !== "online" && (
            <TextField
              label="オフライン会場"
              value={venueOffline}
              onChange={(e) => setVenueOffline(e.target.value)}
              fullWidth
            />
          )}
          {venueType !== "offline" && (
            <TextField
              label="オンライン会場（Discord 招待 URL など）"
              value={venueOnline}
              onChange={(e) => setVenueOnline(e.target.value)}
              fullWidth
            />
          )}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              イベント画像（OG画像 {EVENT_IMAGE.width}×{EVENT_IMAGE.height}・任意）
            </Typography>
            {imagePreview && (
              <Box
                component="img"
                src={imagePreview}
                alt="preview"
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
            )}
            <Stack direction="row" spacing={1}>
              <ImageCropField
                label={imagePreview ? "画像を変更" : "画像を選択"}
                onCropped={setCropped}
              />
              {imagePreview && (
                <Button color="error" onClick={clearImage}>
                  削除
                </Button>
              )}
            </Stack>
          </Box>

          {createEvent.isError && (
            <Typography color="error" variant="body2">
              作成に失敗しました。入力内容を確認してください。
            </Typography>
          )}
          <Stack direction="row" spacing={2} justifyContent="flex-end">
            <Button onClick={() => navigate(-1)}>キャンセル</Button>
            <Button
              variant="contained"
              disabled={!canSubmit || createEvent.isPending}
              onClick={submit}
            >
              作成
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
