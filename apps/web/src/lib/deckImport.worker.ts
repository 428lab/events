import { parseDeckImport, convertDeckImport, previewDeckImportId, DeckImportJsonError } from "@eventer/shared";
import type { DeckContent, DeckImportIssue } from "@eventer/shared";
export type ImportValidationResult = { revision: number } & (
  | { ok: true; title: string; content: DeckContent }
  | { ok: false; error: string; issues: DeckImportIssue[]; truncated: boolean; line?: number; column?: number }
);
self.onmessage = (event: MessageEvent<{ raw: string; revision: number }>) => {
  const { raw, revision } = event.data;
  let result: ImportValidationResult;
  try {
    const parsed = parseDeckImport(raw);
    result = parsed.ok
      ? { revision, ok: true, ...convertDeckImport(parsed.value, previewDeckImportId) }
      : { revision, ok: false, error: "invalid_deck_import", issues: parsed.issues, truncated: parsed.truncated };
  } catch (error) {
    result = { revision, ok: false, error: error instanceof DeckImportJsonError ? error.code : "validation_failed", issues: [], truncated: false,
      ...(error instanceof DeckImportJsonError ? { line: error.line, column: error.column } : {}) };
  }
  self.postMessage(result);
};
