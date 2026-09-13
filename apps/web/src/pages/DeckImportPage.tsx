import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, Stack, TextField, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMe, useLogout } from "../api/hooks.js";
import { useDeckImport } from "../lib/useDeckImport.js";
import { downloadImport, readImportFile } from "../lib/deckImportSession.js";
import { useDeckLeaveWarning } from "../lib/useDeckLeaveWarning.js";
import { describeImportIssue, importIssueLocation } from "../lib/deckImportIssue.js";
import { DeckImportPreview } from "../components/DeckImportPreview.js";

export function DeckImportPage() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();
  const logout = useLogout();
  const model = useDeckImport(me?.id ?? null);
  const { draft, result, owned, locked, validating, saving } = model;
  const [reviewed, setReviewed] = useState(false), [publicAccepted, setPublicAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadingInput, setLoadingInput] = useState(false);
  const [now, setNow] = useState(Date.now());
  const errorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(draft.revision); revision.current = draft.revision;
  const owner = useRef(me?.id); owner.current = me?.id;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setReviewed(false); setPublicAccepted(false); }, [draft.revision, me?.id, result]);
  useEffect(() => { if (result && !result.ok) errorRef.current?.focus(); }, [result]);
  useEffect(() => {
    if (draft.state === "success" && draft.receipt && owned && !model.storageError) navigate(`/decks/${draft.receipt.id}/edit`, { replace: true });
  }, [draft.state, draft.receipt, owned, model.storageError, navigate]);
  useEffect(() => {
    if (!draft.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [draft.retryAt]);
  useDeckLeaveWarning(owned && (draft.state === "pending" || (draft.state === "input" && !!draft.raw)), t("deckImport.leave"));

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice(t("common.copied")); }
    catch { setNotice(t("deckImport.failure")); }
  }
  async function asset(name: string) {
    const response = await fetch(`/deck-import/v1/${name}`);
    if (!response.ok) throw new Error("unavailable");
    return response.text();
  }
  async function replace(load: () => Promise<string>) {
    if (locked || saving || loadingInput || (draft.raw && !window.confirm(t("deckImport.replace")))) return;
    const start = draft.revision, startOwner = me?.id;
    setLoadingInput(true); setNotice("");
    try {
      const raw = await load();
      if (alive.current && revision.current === start && owner.current === startOwner) model.replace(raw);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setNotice(t(code === "file_type" ? "deckImport.fileType" : code === "too_large" ? "deckImport.tooLarge" : code === "invalid_encoding" ? "deckImport.encoding" : "deckImport.failure"));
    } finally { if (alive.current) setLoadingInput(false); }
  }
  const login = async () => {
    if (me && !window.confirm(t("deckImport.signOutConfirm"))) return;
    if (!model.backup()) return;
    try {
      if (me) await logout.mutateAsync();
      navigate("/login?next=%2Fdecks%2Fimport");
    } catch { setNotice(t("deckImport.failure")); }
  };
  const discard = () => { if (window.confirm(t("deckImport.discardConfirm"))) { if (model.reset()) navigate("/decks"); } };
  if (isLoading) return <Typography>{t("common.loading")}</Typography>;
  if (!owned) return <Stack spacing={2}><Alert severity="warning">{t("deckImport.wrongOwner")}</Alert><Button onClick={login}>{t("deckImport.login")}</Button><Button onClick={discard}>{t("deckImport.discard")}</Button></Stack>;
  const retrySeconds = Math.max(0, Math.ceil(((draft.retryAt ?? 0) - now) / 1000));
  const errorText = result && !result.ok
    ? t(result.error === "invalid_encoding" ? "deckImport.encoding" : result.error === "too_large" ? "deckImport.tooLarge" : result.error === "invalid_json" ? "deckImport.syntax" : "deckImport.constraint") : "";
  return <Stack spacing={3}>
    <Typography variant="h5" fontWeight={700}>{t("deckImport.title")}</Typography>
    <Typography>{t("deckImport.intro")}</Typography>
    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
      <Link href="/deck-import/v1/spec.md" target="_blank" rel="noreferrer">{t("deckImport.spec")}</Link>
      <Link href="/deck-import/v1/spec.md" download>{t("deckImport.downloadSpec")}</Link>
      <Button onClick={() => void asset("prompt.txt").then(copy).catch(() => setNotice(t("deckImport.failure")))}>{t("deckImport.prompt")}</Button>
      {(["title", "bullets", "comparison"] as const).map((name) => <Button key={name} disabled={locked || loadingInput || saving} onClick={() => void replace(() => asset(`sample-${name}.json`))}>{t(name === "title" ? "deckImport.sampleTitle" : name === "bullets" ? "deckImport.sampleBullets" : "deckImport.sampleComparison")}</Button>)}
    </Stack>
    <Alert severity="info">{t("deckImport.recovery")}</Alert>
    {model.storageError && <Alert severity="error">{t("deckImport.storage")}</Alert>}
    {notice && <Alert severity="info">{notice}</Alert>}
    {draft.state !== "success" && <>
      <TextField inputRef={inputRef} label={t("deckImport.raw")} multiline minRows={10} maxRows={22} value={draft.raw} disabled={locked || saving || loadingInput} onChange={(event) => model.edit(event.target.value)} slotProps={{ input: { sx: { fontFamily: "monospace" } } }} />
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        <Button component="label" disabled={locked || saving || loadingInput}>{t("deckImport.file")}<input hidden type="file" accept=".json" disabled={locked || saving || loadingInput} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void replace(() => readImportFile(files)); }} /></Button>
        <Button onClick={() => model.validate()} disabled={locked || saving || loadingInput || validating || !draft.raw.trim()}>{t(validating ? "deckImport.validating" : "deckImport.validate")}</Button>
        {validating && <Button onClick={model.cancelValidation}>{t("deckImport.cancelValidation")}</Button>}
        <Button onClick={() => downloadImport(draft.raw)} disabled={saving}>{t("deckImport.download")}</Button>
      </Stack>
    </>}
    {result && !result.ok && <Box ref={errorRef} tabIndex={-1} role="alert">
      <Typography>{errorText} {result.line && t("deckImport.position", { line: result.line, column: result.column })}</Typography>
      {result.issues.map((issue, i) => <Typography key={i} sx={{ overflowWrap: "anywhere" }}>{importIssueLocation(issue.path, t)} — {issue.path} / {issue.code}: {describeImportIssue(issue, t)}</Typography>)}
      {result.truncated && <Typography>{t("deckImport.truncated")}</Typography>}
      <Button onClick={() => inputRef.current?.focus()}>{t("deckImport.edit")}</Button>
      <Button onClick={() => void copy(`${t("deckImport.repairIntro")}\n${errorText}\n${result.issues.map((issue) => `${importIssueLocation(issue.path, t)} / ${issue.path}: ${describeImportIssue(issue, t)}`).join("\n")}`)}>{t("deckImport.repair")}</Button>
    </Box>}
    {result?.ok && <DeckImportPreview content={result.content} />}
    {draft.status && <Alert severity="warning">{draft.status >= 500 ? t("deckImport.pending") : draft.status === 429 ? t("deckImport.quota", { n: retrySeconds }) : draft.status === 401 ? t("deckImport.unauthorized") : draft.status === 409 ? t("deckImport.conflict") : draft.status === 410 ? t("deckImport.deleted") : draft.status === 403 ? t("deckImport.forbidden") : [404, 405].includes(draft.status) ? t("deckImport.unavailable") : draft.state === "pending" ? t("deckImport.pending") : t("deckImport.rejected", { status: draft.status })}</Alert>}
    {saving ? <Alert severity="info">{t("deckImport.saving")}</Alert> : draft.state === "pending" ? <Alert severity="warning">{t("deckImport.pending")}</Alert> : null}
    {draft.state === "input" && <Stack>
      <Alert severity="warning">{t("deckImport.publicNotice")}</Alert>
      {me && draft.ownerId === null && <Button onClick={() => { if (window.confirm(t("deckImport.bindConfirm"))) model.bindOwner(); }}>{t("deckImport.bind")}</Button>}
      <FormControlLabel label={t("deckImport.reviewed")} control={<Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} disabled={!result?.ok || saving || (me != null && !draft.ownerId)} />} />
      <FormControlLabel label={t("deckImport.publicCheck")} control={<Checkbox checked={publicAccepted} onChange={(e) => setPublicAccepted(e.target.checked)} disabled={!result?.ok || saving || (me != null && !draft.ownerId)} />} />
      {me ? <Button variant="contained" disabled={!result?.ok || !reviewed || !publicAccepted || saving || !draft.ownerId} onClick={() => void model.save()}>{t("deckImport.save")}</Button> : <Button onClick={login}>{t("deckImport.login")}</Button>}
      <Button onClick={discard} disabled={saving}>{t("deckImport.discard")}</Button>
    </Stack>}
    {draft.state === "pending" && <Button disabled={saving || retrySeconds > 0} onClick={() => void model.save()}>{t("deckImport.retry")}</Button>}
    {draft.status === 401 && <Button disabled={saving} onClick={login}>{t("deckImport.login")}</Button>}
    {draft.state === "blocked" && <Button onClick={discard}>{t("deckImport.discard")}</Button>}
    {draft.state === "success" && <Alert severity="success">{t("deckImport.success")}</Alert>}
    {draft.receipt && <Button href={`/decks/${draft.receipt.id}/edit`}>{t("deckImport.open")}</Button>}
    {draft.state === "blocked" && [409, 410].includes(draft.status!) && <Button onClick={() => { if (window.confirm(t("deckImport.restartConfirm"))) model.reset(); }}>{t("deckImport.restart")}</Button>}
  </Stack>;
}
