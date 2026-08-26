import { useRef, useState } from "react";
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
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MeetPrize, MeetPrizeCondition } from "@eventer/shared";
import {
  MEET_PRIZE_MAX,
  MEET_PRIZE_THRESHOLD_PRESETS,
  meetPrizeImageUrl,
} from "@eventer/shared";
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
  return prize.conditionType === "meet_count"
    ? t("eventSocial.meetPrizeCondCount", { n: prize.threshold ?? 0 })
    : t("eventSocial.meetPrizeCondTop");
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
  const [imageFailed, setImageFailed] = useState(false);
  // 隠しファイル入力は1つだけ置き、どの景品への設定かを ref で覚える
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageTargetRef = useRef<string | null>(null);
  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    uploadImage.isPending ||
    removeImage.isPending;

  const pickImage = (prizeId: string) => {
    imageTargetRef.current = prizeId;
    fileInputRef.current?.click();
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
    (draft.conditionType === "top_rank" ||
      (/^\d+$/.test(draft.threshold) &&
        Number(draft.threshold) >= 1 &&
        Number(draft.threshold) <= 1000));

  return (
    <Box sx={{ pl: 3, mt: 1 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {t("eventForm.meetPrizeSaveNote")}
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
            <IconButton
              size="small"
              aria-label={
                prize.imageKey
                  ? t("eventForm.meetPrizeImageChange")
                  : t("eventForm.meetPrizeImageSet")
              }
              title={t("eventForm.meetPrizeImageHelp")}
              disabled={busy}
              onClick={() => pickImage(prize.id)}
            >
              <ImageOutlinedIcon fontSize="small" />
            </IconButton>
            {prize.imageKey && (
              <IconButton
                size="small"
                aria-label={t("eventForm.meetPrizeImageRemove")}
                disabled={busy}
                onClick={() =>
                  removeImage.mutate(prize.id, {
                    onError: () => setImageFailed(true),
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const prizeId = imageTargetRef.current;
          // 同じファイルをもう一度選べるように毎回リセットする
          e.target.value = "";
          if (!file || !prizeId) return;
          setImageFailed(false);
          uploadImage.mutate(
            { prizeId, file },
            { onError: () => setImageFailed(true) },
          );
        }}
      />
      {failed && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setFailed(false)}>
          {t("eventForm.meetPrizeSaveFailed")}
        </Alert>
      )}
      {imageFailed && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setImageFailed(false)}>
          {t("eventForm.meetPrizeImageFailed")} {t("eventForm.meetPrizeImageHelp")}
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
