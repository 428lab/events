import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDeckImport } from "./deckImport.js";
import { ApiError, NetworkError } from "./client.js";
const receipt = { id: "11111111-1111-4111-8111-111111111111", slug: "0123456789", replayed: false };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("saveDeckImport raw transport and ambiguity", () => {
  it("sends original bytes with caller-owned key and cookie, without envelope or automatic retry", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const raw = " \n{\"format\":\"events-lab-deck\"}\t";
    expect(await saveDeckImport(raw, receipt.id, "owner-A")).toEqual(receipt);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/decks/import");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: raw, credentials: "include", headers: { "Content-Type": "application/json", "X-Deck-Import-Key": receipt.id, "X-Deck-Import-Owner": "owner-A" } });
  });
  it("20-second deadline aborts waiting but never retries or reports definitive rejection", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise((_yes, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    vi.stubGlobal("fetch", fetch);
    let result: unknown;
    const wait = saveDeckImport("raw", receipt.id, "owner-A").catch((error) => { result = error; });
    await vi.advanceTimersByTimeAsync(19999); expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1); await wait;
    expect(result).toBeInstanceOf(NetworkError);
    expect(result).toMatchObject({ timedOut: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["not JSON", JSON.stringify({ id: "bad", slug: "0123456789", replayed: false }), JSON.stringify({ ...receipt, replayed: "false" })])("malformed success remains unconfirmed: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 201 })));
    await expect(saveDeckImport("raw", receipt.id, "owner-A")).rejects.toBeInstanceOf(NetworkError);
  });
  it("retains Retry-After on definitive HTTP errors for caller-owned same-key retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"import_daily_limit"}', { status: 429, headers: { "Retry-After": "60" } })));
    try { await saveDeckImport("raw", receipt.id, "owner-A"); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); expect(error).toMatchObject({ status: 429, body: { retryAfter: 60 } }); }
  });
});
