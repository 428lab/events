import { ApiError, NetworkError } from "./client.js";
import { isImportReceipt, type ImportReceipt } from "../lib/deckImportSession.js";

/** Original source bytes and one caller-owned key; no mutation retry or JSON reformatting. */
export async function saveDeckImport(raw: string, key: string, expectedOwner: string): Promise<ImportReceipt> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch("/api/decks/import", {
      method: "POST", credentials: "include", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Deck-Import-Key": key, "X-Deck-Import-Owner": expectedOwner }, body: raw,
    });
    let body: unknown;
    try { body = await response.json(); } catch {
      if (!response.ok) throw new ApiError(response.status, { error: "unavailable" });
      throw new NetworkError(false);
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ApiError(response.status, { ...(body && typeof body === "object" ? body : {}), retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 });
    }
    if (![200, 201].includes(response.status) || !isImportReceipt(body)) throw new NetworkError(false);
    return body;
  } catch (error) {
    if (error instanceof ApiError || error instanceof NetworkError) throw error;
    throw new NetworkError(timedOut, error);
  } finally { clearTimeout(timer); }
}
