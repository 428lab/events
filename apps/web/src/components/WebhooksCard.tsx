import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { MAX_WEBHOOKS_PER_SCOPE, webhookKindFromUrl } from "@eventer/shared";
import type { WebhookView } from "@eventer/shared";
import { useWebhookMutations, useWebhooks, type WebhookOwner } from "../api/webhookHooks.js";
import { errorMessage } from "../lib/errorMessage.js";
import { formatDateTime } from "../lib/format.js";

type Topics = { notifyInquiry: boolean; notifyJoin: boolean; notifyCancel: boolean };
const ALL_ON: Topics = { notifyInquiry: true, notifyJoin: true, notifyCancel: true };

/** Discord / Slack 通知の設定 (docs/webhooks.md)。コミュニティ編集ページとイベントの運営ページで使う。
 * URL は保存後に表示しない（サーバーも返さない。ホストと末尾4文字だけ） */
/** `hideTitle`: 見出しを持つ囲み（イベントの運営ページのアコーディオン）の中で使うとき */
export function WebhooksCard({ owner, hideTitle }: { owner: WebhookOwner; hideTitle?: boolean }) {
  const { t } = useTranslation();
  const { data: webhooks } = useWebhooks(owner);
  const m = useWebhookMutations(owner);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [topics, setTopics] = useState<Topics>(ALL_ON);
  const urlOk = url.trim() === "" || webhookKindFromUrl(url) !== null;
  const full = (webhooks?.length ?? 0) >= MAX_WEBHOOKS_PER_SCOPE;

  const add = () =>
    m.create.mutate(
      { url: url.trim(), label: label.trim(), ...topics },
      { onSuccess: () => { setUrl(""); setLabel(""); setTopics(ALL_ON); } },
    );

  return (
    <Box id="webhooks" tabIndex={-1} sx={{ scrollMarginTop: 88 }}>
      {!hideTitle && <Typography variant="h6" component="h2" gutterBottom>{t("webhooks.title")}</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("community" in owner ? "webhooks.introCommunity" : "webhooks.introEvent")}
      </Typography>

      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {webhooks && webhooks.length === 0 && <Typography variant="body2" color="text.secondary">{t("webhooks.empty")}</Typography>}
        {webhooks?.map((w) => <WebhookRow key={w.id} w={w} owner={owner} />)}
      </Stack>

      <Stack spacing={1.5}>
        <TextField
          size="small"
          label={t("webhooks.urlLabel")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={!urlOk}
          helperText={urlOk ? t("webhooks.urlHelp") : t("webhooks.urlInvalid")}
          inputProps={{ autoComplete: "off", spellCheck: false }}
        />
        <TextField size="small" label={t("webhooks.labelLabel")} value={label} onChange={(e) => setLabel(e.target.value)} inputProps={{ maxLength: 60 }} />
        <TopicChecks value={topics} onChange={setTopics} />
        {full && <Alert severity="info">{t("webhooks.limit", { limit: MAX_WEBHOOKS_PER_SCOPE })}</Alert>}
        {m.create.isError && (
          <Alert severity="error">
            {errorMessage(m.create.error, { unsupported_webhook_url: t("webhooks.urlInvalid"), webhook_limit: t("webhooks.limit", { limit: MAX_WEBHOOKS_PER_SCOPE }), default: t("webhooks.saveFailed") })}
          </Alert>
        )}
        <Box>
          <Button variant="contained" onClick={add} disabled={!url.trim() || !urlOk || full || m.create.isPending}>
            {t("webhooks.add")}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

function TopicChecks({ value, onChange, disabled }: { value: Topics; onChange: (v: Topics) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const item = (k: keyof Topics, label: string) => (
    <FormControlLabel
      control={<Checkbox size="small" checked={value[k]} disabled={disabled} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />}
      label={label}
    />
  );
  return (
    <FormGroup row>
      {item("notifyInquiry", t("webhooks.topicInquiry"))}
      {item("notifyJoin", t("webhooks.topicJoin"))}
      {item("notifyCancel", t("webhooks.topicCancel"))}
    </FormGroup>
  );
}

function WebhookRow({ w, owner }: { w: WebhookView; owner: WebhookOwner }) {
  const { t } = useTranslation();
  const m = useWebhookMutations(owner);
  const test = m.test;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={w.kind === "discord" ? "Discord" : "Slack"} />
        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{w.urlHint}</Typography>
        {w.label && <Typography variant="body2" color="text.secondary">{w.label}</Typography>}
        {!w.active && <Chip size="small" color="warning" label={t("webhooks.stopped")} />}
      </Stack>
      <TopicChecks
        value={{ notifyInquiry: w.notifyInquiry, notifyJoin: w.notifyJoin, notifyCancel: w.notifyCancel }}
        disabled={m.update.isPending}
        onChange={(v) => m.update.mutate({ id: w.id, patch: v })}
      />
      {!w.active && (
        <Alert severity="warning" sx={{ mb: 1 }} action={
          <Button color="inherit" size="small" onClick={() => m.update.mutate({ id: w.id, patch: { active: true } })}>{t("webhooks.resume")}</Button>
        }>
          {t("webhooks.stoppedHelp", { error: w.lastError ?? "-" })}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button size="small" variant="outlined" disabled={test.isPending} onClick={() => test.mutate(w.id)}>{t("webhooks.test")}</Button>
        <Button size="small" color="error" disabled={m.remove.isPending} onClick={() => { if (window.confirm(t("webhooks.removeConfirm"))) m.remove.mutate(w.id); }}>
          {t("webhooks.remove")}
        </Button>
        {w.lastSentAt && <Typography variant="caption" color="text.secondary">{t("webhooks.lastSent", { time: formatDateTime(w.lastSentAt) })}</Typography>}
      </Stack>
      {test.data && (
        <Typography variant="caption" color={test.data.ok ? "success.main" : "error"} role="status">
          {test.data.ok ? t("webhooks.testOk") : t("webhooks.testFailed", { status: test.data.status ?? "-" })}
        </Typography>
      )}
    </Box>
  );
}
