import { DECK_IMPORT_MAX_BYTES, decodeDeckImport } from "@eventer/shared";

export const DECK_IMPORT_STORAGE_KEY = "deck-import-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface ImportReceipt { id: string; slug: string; replayed: boolean }
export function isImportReceipt(value: unknown): value is ImportReceipt {
  if (!value || typeof value !== "object") return false;
  const r = value as ImportReceipt;
  return typeof r.id === "string" && uuid.test(r.id) && typeof r.slug === "string" && /^[0-9a-f]{10}$/.test(r.slug) && typeof r.replayed === "boolean";
}
export interface ImportDraft {
  raw: string; revision: number; ownerId: string | null; key: string | null;
  state: "input" | "pending" | "success" | "blocked";
  receipt?: ImportReceipt; status?: number; retryAt?: number;
}
function parseDraft(value: unknown): ImportDraft {
  if (!value || typeof value !== "object") throw new Error("storage_unavailable");
  const r = value as ImportDraft;
  if (typeof r.raw !== "string" || !Number.isSafeInteger(r.revision) || r.revision < 0 ||
      !(r.ownerId === null || typeof r.ownerId === "string") || !(r.key === null || (typeof r.key === "string" && uuid.test(r.key))) ||
      !["input", "pending", "success", "blocked"].includes(r.state) ||
      (r.state !== "input" && (!r.ownerId || !r.key)) || (r.state === "success" && !isImportReceipt(r.receipt)) ||
      (r.receipt !== undefined && !isImportReceipt(r.receipt)) || (r.status !== undefined && !Number.isInteger(r.status)) ||
      (r.retryAt !== undefined && !Number.isFinite(r.retryAt))) throw new Error("storage_unavailable");
  return r;
}
export const emptyImportDraft = (): ImportDraft => ({ raw: "", revision: 0, ownerId: null, key: null, state: "input" });

export function readImportDraft(storage: Storage): ImportDraft {
  const raw = storage.getItem(DECK_IMPORT_STORAGE_KEY);
  return raw === null ? emptyImportDraft() : parseDraft(JSON.parse(raw));
}
/** This is a precondition of POST, not a best-effort background backup. */
export function writeImportDraft(storage: Storage, record: ImportDraft): void {
  const raw = JSON.stringify(record);
  storage.setItem(DECK_IMPORT_STORAGE_KEY, raw);
  if (storage.getItem(DECK_IMPORT_STORAGE_KEY) !== raw) throw new Error("storage_unavailable");
}
export function ownsImportDraft(record: ImportDraft, ownerId: string | null): boolean {
  return record.ownerId === null || record.ownerId === ownerId;
}
export async function readImportFile(files: FileList | readonly File[]): Promise<string> {
  if (files.length !== 1 || !/\.json$/i.test(files[0].name)) throw new Error("file_type");
  if (files[0].size > DECK_IMPORT_MAX_BYTES) throw new Error("too_large");
  return decodeDeckImport(new Uint8Array(await files[0].arrayBuffer()));
}
export function downloadImport(raw: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "deck-import.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
