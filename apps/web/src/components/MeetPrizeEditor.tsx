import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HideImageOutlinedIcon from "@mui/icons-material/HideImageOutlined";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MeetPrize, MeetPrizeCondition } from "@eventer/shared";
import {
  MEET_PRIZE_IMAGE,
  MEET_PRIZE_MAX,
  MEET_PRIZE_THRESHOLD_PRESETS,
  meetPrizeImageUrl,
} from "@eventer/shared";
import { ImageCropField } from "./ImageCropField.js";
import { errorMessage } from "../lib/errorMessage.js";
import {
  useCreateMeetPrize,
  useDeleteMeetPrize,
  useDeleteMeetPrizeImage,
  useMeetPrizeDefinitions,
  useUpdateMeetPrize,
  useUploadMeetPrizeImage,
} from "../api/meetPrizeHooks.js";

/**
 * 景品の定義の編集 (#431)。EditEventPage の「出会いの景品」トグルの下に置く。
 *
 * イベント本体のフォームと違い、**追加・変更は即保存**される（表彰の CRUD と
 * 同じ型）。オフのイベントでも編集できる（オフのまま仕込んで当日オンにする運用）
 * ため、一覧はオフでも動く staff 用の定義一覧から読む（達成者まで数える
 * デスク用の重い口は使わない）。
 */

interface Draft {
  id: string | null; // null は新規
  name: string;
  description: string;
  conditionType: MeetPrizeCondition;
  threshold: string; // 入力欄の生値
  stock: string;
}

const emptyDraft: Draft = {
  id: null,
  name: "",
  description: "",
  conditionType: "meet_count",
  threshold: String(MEET_PRIZE_THRESHOLD_PRESETS[0]),
  stock: "1",
};

function conditionLabel(prize: MeetPrize, t: TFunction): string {
  if (prize.conditionType === "meet_count") {
    return t("eventSocial.meetPrizeCondCount", { n: prize.threshold ?? 0 });
  }
  return prize.conditionType === "top_rank"
    ? t("eventSocial.meetPrizeCondTop")
    : t("eventSocial.meetPrizeCondBingo");
}

export function MeetPrizeEditor({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data } = useMeetPrizeDefinitions(eventId, Boolean(eventId));
  const create = useCreateMeetPrize(eventId);
  const update = useUpdateMeetPrize(eventId);
  const remove = useDeleteMeetPrize(eventId);
  const uploadImage = useUploadMeetPrizeImage(eventId);
  const removeImage = useDeleteMeetPrizeImage(eventId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    uploadImage.isPending ||
    removeImage.isPending;

  /** クロップ済みの画像を上げる。失敗は理由別の文言で出す（サイズ超過は
   * クロップ側の縮小でまず起きないが、起きたときに原因が分かるように） */
  const uploadCropped = (prizeId: string, blob: Blob) => {
    setImageError(null);
    uploadImage.mutate(
      { prizeId, blob },
      {
        onError: (e) =>
          setImageError(
            errorMessage(e, {
              too_large: t("eventForm.meetPrizeImageTooLarge", { mb: MEET_PRIZE_IMAGE.maxBytes / (1024 * 1024) }),
              invalid_image: t("eventForm.meetPrizeImageInvalid"),
              invalid_content_type: t("eventForm.meetPrizeImageInvalid"),
              default: t("eventForm.meetPrizeImageFailed"),
            }),
          ),
      },
    );
  };

  const prizes = data?.prizes ?? [];

  const save = () => {
    if (!draft) return;
    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      conditionType: draft.conditionType,
      threshold:
        draft.conditionType === "meet_count" ? Number(draft.threshold) : null,
      stock: Number(draft.stock),
    };
    setFailed(false);
    const done = {
      onSuccess: () => setDraft(null),
      onError: () => setFailed(true),
    };
    if (draft.id) update.mutate({ prizeId: draft.id, input }, done);
    else create.mutate(input, done);
  };

  const draftValid =
    draft !== null &&
    draft.name.trim().length > 0 &&
    /^\d+$/.test(draft.stock) &&
    Number(draft.stock) <= 1000 &&
    (draft.conditionType !== "meet_count" ||
      (/^\d+$/.test(draft.threshold) &&
        Number(draft.threshold) >= 1 &&
        Number(draft.threshold) <= 1000));

  return (
    <Box sx={{ pl: 3, mt: 1 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {t("eventForm.meetPrizeSaveNote")}{" "}
        {t("eventForm.meetPrizeImageHelp", { mb: MEET_PRIZE_IMAGE.maxBytes / (1024 * 1024) })}
      </Typography>
      <Stack spacing={0.75}>
        {prizes.map((prize) => (
          <Stack
            key={prize.id}
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {prize.imageKey && (
              <img
                src={meetPrizeImageUrl(eventId, prize.id, prize.imageKey) ?? undefined}
                alt={prize.name}
                style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }}
              />
            )}
            <Typography variant="body2" fontWeight={600}>
              {prize.name}
            </Typography>
            <Chip size="small" variant="outlined" label={conditionLabel(prize, t)} />
            <Chip
              size="small"
              variant="outlined"
              label={`${t("eventForm.meetPrizeStock")} ${prize.stock}`}
            />
            <IconButton
              size="small"
              aria-label={t("eventForm.meetPrizeEdit")}
              disabled={busy}
              onClick={() =>
                setDraft({
                  id: prize.id,
                  name: prize.name,
                  description: prize.description,
                  conditionType: prize.conditionType,
                  threshold: String(
                    prize.threshold ?? MEET_PRIZE_THRESHOLD_PRESETS[0],
                  ),
                  stock: String(prize.stock),
                })
              }
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
            {/* 画像はイベント画像と同じ部品でクロップ・縮小してから上げる
                （カードは正方形サムネイルなので 512×512。スマホの大きな写真も
                ここで 1MB 以内に収まる） */}
            <ImageCropField
              label={
                prize.imageKey
                  ? t("eventForm.meetPrizeImageChange")
                  : t("eventForm.meetPrizeImageSet")
              }
              busy={busy}
              size="small"
              outWidth={MEET_PRIZE_IMAGE.width}
              outHeight={MEET_PRIZE_IMAGE.height}
              maxBytes={MEET_PRIZE_IMAGE.maxBytes}
              onCropped={(blob) => uploadCropped(prize.id, blob)}
            />
            {prize.imageKey && (
              <IconButton
                size="small"
                aria-label={t("eventForm.meetPrizeImageRemove")}
                disabled={busy}
                onClick={() =>
                  removeImage.mutate(prize.id, {
                    onError: (e) =>
                      setImageError(
                        errorMessage(e, {
                          default: t("eventForm.meetPrizeImageFailed"),
                        }),
                      ),
                  })
                }
              >
                <HideImageOutlinedIcon fontSize="small" />
              </IconButton>
            )}
            <IconButton
              size="small"
              aria-label={t("common.delete")}
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("eventForm.meetPrizeDeleteConfirm"))) {
                  remove.mutate(prize.id, { onError: () => setFailed(true) });
                }
              }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      {failed && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setFailed(false)}>
          {t("eventForm.meetPrizeSaveFailed")}
        </Alert>
      )}
      {imageError && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setImageError(null)}>
          {imageError}
        </Alert>
      )}
      {prizes.length >= MEET_PRIZE_MAX ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t("eventForm.meetPrizeTooMany", { n: MEET_PRIZE_MAX })}
        </Typography>
      ) : (
        <Button
          size="small"
          startIcon={<AddIcon />}
          sx={{ mt: 1 }}
          disabled={busy}
          onClick={() => setDraft({ ...emptyDraft })}
        >
          {t("eventForm.meetPrizeAdd")}
        </Button>
      )}

      <Dialog open={draft !== null} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {draft?.id ? t("eventForm.meetPrizeEdit") : t("eventForm.meetPrizeAdd")}
        </DialogTitle>
        {draft && (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label={t("eventForm.meetPrizeName")}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                inputProps={{ maxLength: 100 }}
                fullWidth
              />
              <TextField
                label={t("eventForm.meetPrizeDescription")}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                inputProps={{ maxLength: 500 }}
                multiline
                minRows={2}
                fullWidth
              />
              <TextField
                select
                label={t("eventForm.meetPrizeCondition")}
                value={draft.conditionType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    conditionType: e.target.value as MeetPrizeCondition,
                  })
                }
              >
                <MenuItem value="meet_count">
                  {t("eventForm.meetPrizeConditionCount")}
                </MenuItem>
                <MenuItem value="top_rank">
                  {t("eventForm.meetPrizeConditionTop")}
                </MenuItem>
                <MenuItem value="bingo">
                  {t("eventForm.meetPrizeConditionBingo")}
                </MenuItem>
              </TextField>
              {draft.conditionType === "meet_count" && (
                <Box>
                  <TextField
                    label={t("eventForm.meetPrizeThreshold")}
                    value={draft.threshold}
                    onChange={(e) =>
                      setDraft({ ...draft, threshold: e.target.value })
                    }
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
                    size="small"
                    sx={{ width: 120 }}
                  />
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                    {MEET_PRIZE_THRESHOLD_PRESETS.map((n) => (
                      <Chip
                        key={n}
                        size="small"
                        label={n}
                        variant={
                          draft.threshold === String(n) ? "filled" : "outlined"
                        }
                        onClick={() =>
                          setDraft({ ...draft, threshold: String(n) })
                        }
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              <Box>
                <TextField
                  label={t("eventForm.meetPrizeStock")}
                  value={draft.stock}
                  onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
                  inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
                  size="small"
                  sx={{ width: 120 }}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {t("eventForm.meetPrizeStockHelp")}
                </Typography>
              </Box>
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
          <Button variant="contained" disabled={!draftValid || busy} onClick={save}>
            {t("common.save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
