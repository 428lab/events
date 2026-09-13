import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client.js";
import { saveDeckImport } from "../api/deckImport.js";
import { DECK_IMPORT_STORAGE_KEY, emptyImportDraft, isImportReceipt, ownsImportDraft, readImportDraft, writeImportDraft, type ImportDraft } from "./deckImportSession.js";
import type { ImportValidationResult } from "./deckImport.worker.js";

export function useDeckImport(ownerId: string | null, authUpdatedAt = 0) {
  const qc = useQueryClient();
  const [initial] = useState(() => {
    try { return { draft: readImportDraft(sessionStorage), failed: false }; }
    catch { return { draft: emptyImportDraft(), failed: true }; }
  });
  const [draft, setDraft] = useState(initial.draft);
  const current = useRef(draft);
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const [storageError, setStorageError] = useState(initial.failed);
  const [result, setResult] = useState<ImportValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHere, setSavedHere] = useState(false);
  const [ownerMismatch, setOwnerMismatch] = useState(false);
  const generation = useRef(0);
  const sending = useRef(false);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const owned = !ownerMismatch && ownsImportDraft(draft, ownerId);
  const locked = draft.state !== "input";
  function persist(next: ImportDraft): boolean {
    current.current = next; setDraft(next);
    try { writeImportDraft(sessionStorage, next); setStorageError(false); return true; }
    catch { setStorageError(true); return false; }
  }
  function cancelValidation() {
    worker.current?.terminate(); worker.current = null;
    clearTimeout(timer.current); setValidating(false); setResult(null);
  }
  useEffect(() => {
    generation.current++;
    return () => { generation.current++; worker.current?.terminate(); clearTimeout(timer.current); };
  }, []);
  useEffect(() => { setOwnerMismatch(false); }, [ownerId, authUpdatedAt]);
  useEffect(() => { cancelValidation(); }, [ownerId]);
  function edit(raw: string) {
    if (sending.current || current.current.state !== "input" || !ownsImportDraft(current.current, currentOwner.current)) return;
    cancelValidation();
    persist({ ...current.current, raw, revision: current.current.revision + 1, status: undefined, key: null });
  }
  function validate(raw = current.current.raw, revision = current.current.revision) {
    if (sending.current || current.current.state !== "input" || !ownsImportDraft(current.current, currentOwner.current)) return;
    cancelValidation(); setValidating(true);
    const fail = () => {
      worker.current?.terminate(); worker.current = null; clearTimeout(timer.current); setValidating(false);
      setResult({ revision, ok: false, error: "validation_failed", issues: [], truncated: false });
    };
    try {
      const next = new Worker(new URL("./deckImport.worker.ts", import.meta.url), { type: "module" });
      worker.current = next;
      next.onmessage = (event: MessageEvent<ImportValidationResult>) => {
        if (worker.current !== next || current.current.revision !== event.data.revision) return;
        clearTimeout(timer.current); next.terminate(); worker.current = null;
        setResult(event.data); setValidating(false);
      };
      next.onerror = fail;
      timer.current = setTimeout(fail, 10000);
      next.postMessage({ raw, revision });
    } catch { fail(); }
  }
  function replace(raw: string) { edit(raw); validate(current.current.raw, current.current.revision); }
  function bindOwner() {
    if (!ownerId || current.current.ownerId !== null || sending.current) return false;
    return persist({ ...current.current, ownerId });
  }
  function reset(): boolean {
    if (sending.current) return false;
    try {
      sessionStorage.removeItem(DECK_IMPORT_STORAGE_KEY);
      if (sessionStorage.getItem(DECK_IMPORT_STORAGE_KEY) !== null) throw new Error("storage_unavailable");
    } catch { setStorageError(true); return false; }
    cancelValidation(); setSavedHere(false);
    current.current = emptyImportDraft(); setDraft(current.current); setStorageError(false);
    return true;
  }
  async function save() {
    const old = current.current;
    if (ownerMismatch || sending.current || !ownerId || old.ownerId !== ownerId || old.state === "success" || old.state === "blocked" ||
        (old.retryAt && Date.now() < old.retryAt) ||
        (old.state === "input" && (!result?.ok || result.revision !== old.revision))) return;
    const pending: ImportDraft = { ...old, state: "pending", status: undefined, key: old.key ?? crypto.randomUUID() };
    // No POST unless the exact frozen source and key have survived a readback.
    if (!persist(pending)) { current.current = old; setDraft(old); setStorageError(true); return; }
    const requestGeneration = generation.current;
    const persistedPending = JSON.stringify(pending);
    const isCurrentOperation = () => {
      if (generation.current !== requestGeneration || current.current !== pending) return false;
      try { return sessionStorage.getItem(DECK_IMPORT_STORAGE_KEY) === persistedPending; }
      catch { return false; }
    };
    sending.current = true; setSaving(true);
    try {
      const receipt = await saveDeckImport(pending.raw, pending.key!, pending.ownerId!);
      if (!isCurrentOperation()) return;
      persist({ ...pending, raw: "", state: "success", receipt });
      setSavedHere(true);
      void qc.invalidateQueries({ queryKey: ["decks", "mine"] });
    } catch (error) {
      if (!isCurrentOperation()) return;
      if (error instanceof ApiError) {
        const status = error.status;
        const body = error.body as { error?: string; id?: string; slug?: string; retryAfter?: number };
        if (status === 403 && body?.error === "import_owner_mismatch") {
          persist({ ...pending, status });
          setOwnerMismatch(true);
          void qc.invalidateQueries({ queryKey: ["me"] });
        } else if ([400, 413, 415, 422].includes(status)) {
          persist({ ...pending, state: "input", key: null, status });
          cancelValidation();
        } else if ([403, 409, 410].includes(status)) {
          const receipt = { id: body?.id, slug: body?.slug, replayed: true };
          persist({ ...pending, state: "blocked", status, ...(isImportReceipt(receipt) ? { receipt } : {}) });
        } else persist({ ...pending, status, retryAt: status === 429 ? Date.now() + Math.max(1, body?.retryAfter ?? 1) * 1000 : undefined });
      } // Network, timeout and malformed success remain the persisted pending operation.
    } finally {
      // A detached mount must not update its screen or another mount's recovery.
      if (generation.current === requestGeneration) { sending.current = false; setSaving(false); }
    }
  }
  return { draft, owned, locked, storageError, result, validating, saving, savedHere, edit, replace, validate, cancelValidation, bindOwner, reset, save,
    backup: () => persist(current.current) };
}
