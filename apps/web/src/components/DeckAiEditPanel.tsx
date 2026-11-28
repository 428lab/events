import { useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { DECK_IMPORT_LIMITS, deckTooLargeForAi, deckV2Losses, type DeckContent } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { formatDateTime } from "../lib/format.js";
import {
  useIssueEditDeckAgentToken,
  useRevokeEditDeckAgentToken,
  type IssuedEditDeckAgentToken,
} from "../api/deckHooks.js";

/**
 * 作成済みの自分のスライドを AI に直してもらう（docs/agent-deck-token.md §4c。オーナー決定 2026-11-28）。
 * - 「AIに直してもらう」でこのデッキに結び付いたトークンを発行し、AI に渡す指示文を出す
 * - AI が書いている間（agent が渡っている間）は編集できない旨と「AIのアクセスを取り消して編集する」を出す
 * 平文のトークンは発行直後の応答にしか無いので、この画面の state にだけ置く。
 * チームのスライドはチームの欄から発行する（ここでは出さない）。
 */
export function DeckAiEditIssueButton({ deckId, content, onIssued, disabled }: {
  deckId: string;
  /** 保存済みの中身。AI は v2 JSON で読み書きするので、v2 の上限に収まるかを先に確かめる */
  content: DeckContent;
  onIssued: (issued: IssuedEditDeckAgentToken) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const issue = useIssueEditDeckAgentToken(deckId);
  const losses = deckV2Losses(content);
  const limits = { maxSlides: DECK_IMPORT_LIMITS.slides, maxElements: DECK_IMPORT_LIMITS.elementsPerSlide };
  // v2 の上限を超えると、書き出しで切り捨てられたものが AI の書き戻しで消える。発行しない（サーバーも 409）
  const tooLarge = deckTooLargeForAi(losses)
    || (issue.error instanceof ApiError && (issue.error.body as { error?: string } | null)?.error === "deck_too_large_for_ai");
  return (
    <>
      <Button size="small" variant="outlined" disabled={disabled || issue.isPending || tooLarge} onClick={() => {
        if (!window.confirm(t("deckAgent.editConfirm"))) return;
        issue.mutate(undefined, { onSuccess: onIssued });
      }}>
        {t("deckAgent.editIssue")}
      </Button>
      {tooLarge && <Typography variant="caption" color="text.secondary" role="status">{t("deckAgent.editTooLarge", limits)}</Typography>}
      {issue.isError && !tooLarge && <Typography variant="caption" color="error" role="alert">{t("deckAgent.failure")}</Typography>}
    </>
  );
}

/** AI が書いている間の案内。発行した直後なら指示文も出す */
export function DeckAiEditLock({ deckId, expiresAt, issued }: {
  deckId: string;
  expiresAt: number | null;
  issued: IssuedEditDeckAgentToken | null;
}) {
  const { t } = useTranslation();
  const revoke = useRevokeEditDeckAgentToken(deckId);
  const [copied, setCopied] = useState(false);
  const minutes = expiresAt ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000)) : null;
  const instruction = issued
    ? t("deckAgent.editInstruction", { specUrl: issued.specUrl, token: issued.token, expires: formatDateTime(issued.expiresAt) })
    : "";
  async function copy() {
    try { await navigator.clipboard.writeText(instruction); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <Stack spacing={1.5}>
      {/* ボタンは文の下に置く（Alert の action に入れると、狭い画面で文の幅が 0 になる） */}
      <Alert severity="info" sx={{ "& .MuiAlert-message": { minWidth: 0, flex: 1 } }}>
        <Stack spacing={1} alignItems="flex-start">
          <span>{minutes ? t("deckAgent.editWriting", { minutes }) : t("deckAgent.editWritingUnknown")}</span>
          <Button color="inherit" size="small" variant="outlined" disabled={revoke.isPending}
            onClick={() => { if (window.confirm(t("deckAgent.editRevokeConfirm"))) revoke.mutate(); }}
            sx={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "left" }}>
            {t("deckAgent.editRevoke")}
          </Button>
        </Stack>
      </Alert>
      {issued && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">{t("deckAgent.publicNotice")}</Typography>
          <TextField label={t("deckAgent.instructionLabel")} value={instruction} multiline minRows={4}
            slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace" } } }} />
          <Box>
            <Button size="small" onClick={() => void copy()}>{t("deckAgent.copy")}</Button>
            {copied && <Typography component="span" variant="caption" sx={{ ml: 1 }}>{t("common.copied")}</Typography>}
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
