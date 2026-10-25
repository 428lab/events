import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { EVENT_IMAGE } from "@eventer/shared";
import {
  eventImageUrl,
  useDeleteEventImage,
  useUploadEventImage,
} from "../api/hooks.js";
import { ImageCropField } from "./ImageCropField.js";
import { EventImageStudio, type EventImageStudioHandle } from "./EventImageStudio.js";
import { formatDateRange } from "../lib/format.js";

/** イベント編集の保存ボタンが、テンプレートで作りかけの画像をまとめて反映するための口 */
export type EventImageEditorHandle = {
  /** 作りかけの画像をイベント画像としてアップロードする。成功で true */
  applyPendingImage: () => Promise<boolean>;
};

/** 画像はこの部品の中で即アップロードする（イベントの「保存」とは別）。
 * テンプレートで作りかけ（まだ反映していない）かどうかは onPendingChange で親に知らせる */
export const EventImageEditor = forwardRef<
  EventImageEditorHandle,
  {
    event: {
      id: string;
      imageUpdatedAt: number | null;
      title: string;
      startsAt: number;
      endsAt: number;
    };
    onPendingChange?: (pending: boolean) => void;
  }
>(function EventImageEditor({ event, onPendingChange }, ref) {
  const { t } = useTranslation();
  const upload = useUploadEventImage(event.id);
  const studioRef = useRef<EventImageStudioHandle>(null);
  useImperativeHandle(ref, () => ({
    applyPendingImage: async () => (studioRef.current ? studioRef.current.apply() : false),
  }));
  const remove = useDeleteEventImage(event.id);
  const currentUrl = eventImageUrl(event);
  const [mode, setMode] = useState<"upload" | "template">("upload");

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        {t("eventForm.imageHeading", {
          width: EVENT_IMAGE.width,
          height: EVENT_IMAGE.height,
        })}
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={mode}
        onChange={(_e, v) => v && setMode(v)}
        sx={{ mb: 1.5 }}
      >
        <ToggleButton value="upload">
          {t("eventForm.imageModeUpload")}
        </ToggleButton>
        <ToggleButton value="template">
          {t("eventForm.imageModeTemplate")}
        </ToggleButton>
      </ToggleButtonGroup>

      <Typography variant="caption" color="text.secondary" display="block">
        {t("eventForm.imageCurrentLabel")}
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
          {t("eventForm.imageNone")}
        </Typography>
      )}

      {mode === "upload" ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <ImageCropField
            label={t(
              currentUrl ? "eventForm.imageChange" : "eventForm.imageAdd",
            )}
            busy={upload.isPending}
            onCropped={(blob) => upload.mutate(blob)}
          />
          {currentUrl && (
            <Button
              color="error"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t("eventForm.imageRemove")}
            </Button>
          )}
        </Stack>
      ) : (
        <EventImageStudio
          ref={studioRef}
          title={event.title}
          subtitle={formatDateRange(event.startsAt, event.endsAt)}
          onGenerated={(blob) => upload.mutateAsync(blob)}
          onDirtyChange={onPendingChange}
        />
      )}

      {upload.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {t("eventForm.imageUploadError")}
        </Alert>
      )}
    </Box>
  );
});
