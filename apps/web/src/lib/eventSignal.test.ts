import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { EventSignalConfig } from "@eventer/shared";
import {
  addChatHiddenSignal,
  mergeChatHidden,
  parseChatHiddenSignal,
} from "./eventSignal.js";
import type { ChatHiddenOverlay } from "./eventSignal.js";

const serviceSk = generateSecretKey();
const CONFIG: EventSignalConfig = {
  kind: EVENT_SIGNAL_KIND,
  pubkey: getPublicKey(serviceSk),
  topic: "70".repeat(32),
  rev: 1_000,
};
const A = "aa".repeat(32);
const B = "bb".repeat(32);

function signal(content: unknown, opts: { sk?: Uint8Array; kind?: number; topic?: string } = {}) {
  return finalizeEvent({
    kind: opts.kind ?? EVENT_SIGNAL_KIND,
    created_at: 1,
    tags: [["t", opts.topic ?? CONFIG.topic], ["-"]],
    content: typeof content === "string" ? content : JSON.stringify(content),
  }, opts.sk ?? serviceSk);
}

describe("parseChatHiddenSignal (D-POLL-MIN Phase 5a)", () => {
  it("accepts a service-signed signal for this topic", () => {
    expect(parseChatHiddenSignal(signal({ rev: 2_000, hidden: [A], shown: [] }), CONFIG))
      .toEqual({ rev: 2_000, hidden: [A], shown: [] });
  });

  it("rejects another author, kind or topic, a bad signature and malformed content", () => {
    const ok = { rev: 2_000, hidden: [A], shown: [] };
    expect(parseChatHiddenSignal(signal(ok, { sk: generateSecretKey() }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal(ok, { kind: 20079 }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal(ok, { topic: "71".repeat(32) }), CONFIG)).toBeNull();
    // Relay events arrive as fresh JSON (no cached verification), as here.
    const tampered = { ...JSON.parse(JSON.stringify(signal(ok))), content: JSON.stringify({ ...ok, hidden: [B] }) };
    expect(parseChatHiddenSignal(tampered, CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal("not json"), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal({ ...ok, rev: "2000" }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal({ ...ok, rev: 1.5 }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal({ ...ok, hidden: ["not-hex"] }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal({ ...ok, shown: undefined }), CONFIG)).toBeNull();
    expect(parseChatHiddenSignal(signal({ ...ok, hidden: Array(51).fill(A) }), CONFIG)).toBeNull();
  });
});

describe("mergeChatHidden", () => {
  it("adds signals newer than the payload and keeps the newest per note", () => {
    let overlay: ChatHiddenOverlay = new Map();
    overlay = addChatHiddenSignal(overlay, { rev: 2_000, hidden: [A], shown: [] });
    expect(mergeChatHidden([], 1_000, overlay)).toEqual([A]);
    // An older unhide arriving late does not undo the newer hide.
    overlay = addChatHiddenSignal(overlay, { rev: 1_500, hidden: [], shown: [A] });
    expect(mergeChatHidden([], 1_000, overlay)).toEqual([A]);
    overlay = addChatHiddenSignal(overlay, { rev: 3_000, hidden: [], shown: [A] });
    expect(mergeChatHidden([A, B], 1_000, overlay)).toEqual([B]);
  });

  it("ignores signals the payload already reflects", () => {
    const overlay = addChatHiddenSignal(new Map(), { rev: 2_000, hidden: [], shown: [A] });
    // A payload read after the unhide is authoritative, even if A is hidden again there.
    expect(mergeChatHidden([A], 2_000, overlay)).toEqual([A]);
    expect(mergeChatHidden([A], 1_999, overlay)).toEqual([]);
  });
});
