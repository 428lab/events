import { useEffect, useState } from "react";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  useDeckAgentTokens,
  useIssueDeckAgentToken,
  useRevokeDeckAgentToken,
  type DeckAgentToken,
  type IssuedDeckAgentToken,
} from "../api/deckHooks.js";
import { ApiError } from "../api/client.js";
import { formatDateTime } from "../lib/format.js";

/**
 * /decks/import の「AIに書いてもらう」（docs/agent-deck-token.md）。
 * 平文のトークンは発行直後の応答にしか無いので、この画面の state にだけ置く。
 */
export function DeckAgentPanel() {
  const { t } = useTranslation();
  const tokens = useDeckAgentTokens(true);
  const issue = useIssueDeckAgentToken();
  const revoke = useRevokeDeckAgentToken();
  const [issued, setIssued] = useState<IssuedDeckAgentToken | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  // 残り時間の表示だけの時計（通信しない）
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const instruction = issued
    ? t("deckAgent.instruction", { specUrl: issued.specUrl, token: issued.token, expires: formatDateTime(issued.expiresAt) })
    : "";
  // 取り直した直後の残り時間が古い時計で多めに出ないよう、一覧が変わったら時計も合わせる
  useEffect(() => { setNow(Date.now()); }, [tokens.data]);
  const active = (tokens.data ?? []).filter((x) => x.expiresAt > now);
  // 発行したばかりのトークンが取り消し・期限切れになったら指示文も消す
  useEffect(() => {
    if (issued && tokens.data && !tokens.data.some((x) => x.id === issued.id)) setIssued(null);
  }, [issued, tokens.data]);

  async function onIssue() {
    setNotice("");
    try {
      setIssued(await issue.mutateAsync());
    } catch (error) {
      setNotice(t(error instanceof ApiError && error.status === 429 ? "deckAgent.limit" : "deckAgent.failure"));
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(instruction); setNotice(t("common.copied")); }
    catch { setNotice(t("deckAgent.failure")); }
  }
  function onRevoke(token: DeckAgentToken) {
    if (!window.confirm(t("deckAgent.revokeConfirm"))) return;
    revoke.mutate(token.id);
  }

  return <Paper variant="outlined" sx={{ p: 2 }}>
    <Stack spacing={2}>
      <Typography variant="h6" fontWeight={700}>{t("deckAgent.title")}</Typography>
      <Typography>{t("deckAgent.intro")}</Typography>
      <Alert severity="warning">{t("deckAgent.publicNotice")}</Alert>
      <Box><Button variant="contained" disabled={issue.isPending} onClick={() => void onIssue()}>{t(issue.isPending ? "deckAgent.issuing" : "deckAgent.issue")}</Button></Box>
      {notice && <Alert severity="info">{notice}</Alert>}
      {issued && <Stack spacing={1}>
        <TextField label={t("deckAgent.instructionLabel")} value={instruction} multiline minRows={4} slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace" } } }} />
        <Box><Button onClick={() => void copy()}>{t("deckAgent.copy")}</Button></Box>
      </Stack>}
      {active.length > 0 && <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2">{t("deckAgent.active")}</Typography>
          <Button size="small" disabled={tokens.isFetching} onClick={() => void tokens.refetch()}>{t("deckAgent.refresh")}</Button>
        </Stack>
        {active.map((token) => <Paper key={token.id} variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="body2">{t("deckAgent.expiresIn", { minutes: Math.max(1, Math.ceil((token.expiresAt - now) / 60_000)) })} ・ {t("deckAgent.usage", { writes: token.writeCount, images: token.imageCount })}</Typography>
            {token.deck
              ? <Typography sx={{ overflowWrap: "anywhere" }}>{t("deckAgent.created", { title: token.deck.title })}</Typography>
              : <Typography color="text.secondary">{t("deckAgent.waiting")}</Typography>}
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
              {token.deck && <Button href={`/decks/${token.deck.id}/edit`}>{t("deckAgent.openEditor")}</Button>}
              {token.deck && <Button href={`/d/${token.deck.slug}`} target="_blank" rel="noreferrer">{t("deckAgent.openViewer")}</Button>}
              <Button color="error" disabled={revoke.isPending} onClick={() => onRevoke(token)}>{t("deckAgent.revoke")}</Button>
            </Stack>
          </Stack>
        </Paper>)}
      </Stack>}
    </Stack>
  </Paper>;
}
