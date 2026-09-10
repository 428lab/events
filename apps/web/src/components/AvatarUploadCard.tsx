import { useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { Alert, Avatar, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useMe } from "../api/hooks.js";
import { cropToImage, type PixelCrop } from "../lib/cropImage.js";

export function AvatarUploadCard() {
  const { t } = useTranslation(), qc = useQueryClient(), { data: me } = useMe();
  const input = useRef<HTMLInputElement>(null), generation = useRef(0);
  const [src, setSrc] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 }), [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<PixelCrop | null>(null);
  const [error, setError] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const pick = async (file?: File) => {
    if (!file) return;
    setError(false); setSaved(false);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError(true); return; }
    const token = ++generation.current;
    setBusy(true);
    try {
      const image = await createImageBitmap(file);
      const valid = image.width > 0 && image.height > 0 && image.width <= 8192 && image.height <= 8192 && image.width * image.height <= 24_000_000;
      image.close();
      if (token !== generation.current) return;
      if (!valid) throw new Error("invalid_dimensions");
      setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null);
      setSrc(URL.createObjectURL(file));
    } catch { if (token === generation.current) setError(true); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const save = async () => {
    if (!src || !area || busy) return;
    setBusy(true); setError(false);
    try {
      const blob = await cropToImage(src, area, 512, 512, 1024 * 1024);
      // Canvas can silently fall back to PNG on browsers without WebP encoding.
      if (blob.type !== "image/webp" || blob.size > 1024 * 1024) throw new Error("webp_required");
      const response = await fetch("/api/me/avatar", { method: "PUT", credentials: "include", headers: { "Content-Type": "image/webp" }, body: blob });
      if (!response.ok) throw new Error("avatar_upload_failed");
      const result = await response.json() as { avatarUrl: string };
      await qc.cancelQueries({ queryKey: ["me"] });
      qc.setQueryData(["me"], (previous: { user: typeof me } | null | undefined) => previous?.user
        ? { ...previous, user: { ...previous.user, avatarUrl: result.avatarUrl } } : previous);
      void qc.invalidateQueries();
      setSrc(null); setSaved(true);
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <Card variant="outlined"><CardContent>
    <Typography variant="h6" gutterBottom>{t("settings.avatarTitle")}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t("settings.avatarHelp")}</Typography>
    <Stack direction="row" spacing={2} alignItems="center">
      <Avatar src={me?.avatarUrl ?? undefined} sx={{ width: 72, height: 72 }} />
      <Button variant="outlined" disabled={busy} onClick={() => input.current?.click()}>{t("settings.avatarChoose")}</Button>
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void pick(file); }} />
    </Stack>
    {error && !src && <Alert severity="error" sx={{ mt: 2 }}>{t("settings.avatarError")}</Alert>}
    {saved && <Alert severity="success" sx={{ mt: 2 }}>{t("settings.avatarSaved")}</Alert>}
    <Dialog open={Boolean(src)} onClose={() => { if (!busy) setSrc(null); }} fullWidth maxWidth="sm">
      <DialogTitle>{t("settings.avatarTitle")}</DialogTitle>
      <DialogContent>
        <Box sx={{ position: "relative", height: { xs: 260, sm: 340 }, bgcolor: "grey.900" }}>
          {src && <Cropper image={src} crop={crop} zoom={zoom} aspect={1} onCropChange={value => { if (!busy) setCrop(value); }} onZoomChange={value => { if (!busy) setZoom(value); }}
            onCropComplete={(_, pixels) => setArea(pixels)} />}
        </Box>
        <Typography sx={{ mt: 2 }}>{t("eventForm.cropZoom")}</Typography>
        <Slider aria-label={t("eventForm.cropZoom")} min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={(_, value) => setZoom(value as number)} />
        <Typography variant="caption">{t("settings.avatarPreviewHelp")}</Typography>
        {error && <Alert severity="error">{t("settings.avatarError")}</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setSrc(null)}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={busy || !area} onClick={() => void save()}>{t("common.save")}</Button>
      </DialogActions>
    </Dialog>
  </CardContent></Card>;
}
