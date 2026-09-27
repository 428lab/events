import { useRef, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { cutinMessageSchema } from "@eventer/shared";
import { cutinApi } from "../api/liveControlHooks.js";
import { LiveCutin } from "./LiveCutin.js";

export function LiveCutinControl({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [preview, setPreview] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const lastRequest = useRef(0);
  const [result, setResult] = useState<"sent" | "unknown" | null>(null);
  const candidate = edited ? message : name.trim() ? `${name.trim()}${name.trim().endsWith("さん") ? "" : "さん"} 参戦！！` : "";
  const parsed = cutinMessageSchema.safeParse(candidate);
  async function send() {
    if (!parsed.success) return;
    const request = ++lastRequest.current;
    setPendingCount(count => count + 1);
    setResult(null);
    try {
      await cutinApi.trigger(eventId, { message: parsed.data });
      if (request === lastRequest.current) setResult("sent");
    } catch {
      // An unknown response may already have written; do not automatically resend.
      if (request === lastRequest.current) setResult("unknown");
    } finally { setPendingCount(count => count - 1); }
  }
  return <Stack spacing={1.5} sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
    <Typography variant="h6">{t("studio.cutinHeading")}</Typography>
    <Typography variant="body2" color="text.secondary">{t("studio.cutinHint")}</Typography>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
      <TextField size="small" label={t("studio.cutinName")} value={name} onChange={e => setName(e.target.value)} inputProps={{ maxLength: 40 }} />
      <TextField size="small" label={t("studio.cutinMessage")} value={candidate} onChange={e => { setMessage(e.target.value); setEdited(true); }} inputProps={{ maxLength: 80 }} error={candidate.length > 0 && !parsed.success} helperText={candidate && !parsed.success ? t("studio.cutinInvalid") : ""} sx={{ flex: 1 }} />
    </Stack>
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button variant="outlined" disabled={!parsed.success} onClick={() => setPreview(true)}>{t("studio.cutinPreview")}</Button>
      <Button variant="contained" disabled={!parsed.success} onClick={() => void send()}>{pendingCount > 0 ? t("studio.cutinPending") : t("studio.cutinSend")}</Button>
    </Stack>
    {preview && <Box sx={{ position: "relative", width: "100%", maxWidth: 640, aspectRatio: "16 / 9", bgcolor: "#182331", overflow: "hidden" }}>
      <LiveCutin key={candidate} action={{ message: parsed.success ? parsed.data : candidate }} />
      <Typography sx={{ position: "absolute", top: 8, left: 12, color: "white", zIndex: 1, bgcolor: "#09172c" }}>{t("studio.cutinLocalOnly")}</Typography>
      <Button size="small" onClick={() => setPreview(false)} sx={{ position: "absolute", right: 4, bottom: 4, color: "white", zIndex: 1 }}>{t("studio.cutinClose")}</Button>
    </Box>}
    {result && <Alert severity={result === "sent" ? "success" : "warning"}>{t(result === "sent" ? "studio.cutinSent" : "studio.cutinUnknown")}</Alert>}
  </Stack>;
}
