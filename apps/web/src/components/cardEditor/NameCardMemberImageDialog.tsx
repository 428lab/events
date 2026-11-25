import { useState } from "react";
import { Alert, Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { EventNameCard } from "@eventer/shared";
import { api } from "../../api/client.js";
import { cardAssetsKey, uploadCardAsset, useCardAssets } from "../../api/cardDesignHooks.js";
import { messageKey, type MessageKey } from "../../lib/messageKey.js";

/** 名札の代わりの画像を人ごとに選ぶ（オーナー依頼 2026-11-25「アイコンが出せない人は運営側で代わりの画像を
 * 個別にアップロードできるようにできる？」）。このイベントの名札だけで使い、本人のプロフィールのアイコンは変えない。
 * 画像はイベントの名札素材（デザイン編集と同じ置き場）から選ぶか、ここでアップロードする */
export function NameCardMemberImageDialog({ eventId, card, onClose }: {
  eventId: string; card: EventNameCard; onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const assets = useCardAssets(eventId, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["eventNameCards", eventId] });
  const choose = async (assetId: string) => {
    setBusy(true); setError(null);
    try {
      await api.put(`/events/${eventId}/name-card-member-images/${encodeURIComponent(card.id)}`, { assetId });
      await refresh();
      onClose();
    } catch { setError(messageKey("staffOps.nameCardMemberImageFailed")); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const asset = await uploadCardAsset(eventId, file);
      await queryClient.invalidateQueries({ queryKey: cardAssetsKey(eventId) });
      setBusy(false);
      await choose(asset.id);
    } catch { setError(messageKey("staffOps.cardEditorUploadFailed")); setBusy(false); }
  };
  const clear = async () => {
    setBusy(true); setError(null);
    try {
      await api.del(`/events/${eventId}/name-card-member-images/${encodeURIComponent(card.id)}`);
      await refresh();
      onClose();
    } catch { setError(messageKey("staffOps.nameCardMemberImageFailed")); }
    finally { setBusy(false); }
  };
  const list = assets.data?.assets ?? [];
  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>{t("staffOps.nameCardMemberImageFor", { name: card.name })}</DialogTitle>
    <DialogContent>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">{t("staffOps.nameCardMemberImageHelp")}</Typography>
        {error && <Alert severity="error">{t(error.key, error.params)}</Alert>}
        <Button component="label" variant="contained" disabled={busy} sx={{ alignSelf: "flex-start" }}>
          {t("staffOps.nameCardMemberImageUpload")}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
        </Button>
        <Typography variant="subtitle2">{t("staffOps.nameCardMemberImageChoose")}</Typography>
        {assets.isSuccess && list.length === 0 && <Typography variant="body2">{t("staffOps.nameCardMemberImageNone")}</Typography>}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 1 }}>
          {list.map(a => (
            <ButtonBase key={a.id} disabled={busy} onClick={() => void choose(a.id)}
              aria-pressed={card.memberImageAssetId === a.id}
              sx={{ border: "2px solid", borderColor: card.memberImageAssetId === a.id ? "primary.main" : "divider",
                borderRadius: 1, aspectRatio: "1 / 1", overflow: "hidden", bgcolor: "#fff" }}>
              <Box component="img" src={a.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </ButtonBase>
          ))}
        </Box>
      </Stack>
    </DialogContent>
    <DialogActions>
      {card.memberImageAssetId && <Button color="error" disabled={busy} onClick={() => void clear()}>{t("staffOps.nameCardMemberImageClear")}</Button>}
      <Button disabled={busy} onClick={onClose}>{t("staffOps.nameCardMemberImageClose")}</Button>
    </DialogActions>
  </Dialog>;
}
