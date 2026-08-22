import { describe, it, expect } from "vitest";
import {
  appendStaffChatMessage,
  MESSAGE_BUFFER_MAX,
} from "./staffChatBuffer.js";

/**
 * スタッフチャットの受信バッファ (#382 レビュー対応)。
 *
 * roomId は公開値なので部外者がゴミ投稿を流し込める。守るのは
 * 「ゴミを上限＋1件流しても、本物の履歴が画面から押し出されない」こと。
 * 一方で、参加したての staff の発言（許可リストに載る前の〜5秒）は
 * 捨てないこと（受信時に捨てると失われる。リレーは再送しない）。
 */

const STAFF = "a".repeat(64);
const STRANGER = "b".repeat(64);

function msg(id: string, pubkey: string, createdAt: number) {
  return { id, pubkey, created_at: createdAt };
}

const allowStaff = (pk: string) => pk === STAFF;

describe("appendStaffChatMessage (#382)", () => {
  it("IDで重複排除し、時刻順に並べる", () => {
    const a = msg("a", STAFF, 100);
    const b = msg("b", STAFF, 50);
    const once = appendStaffChatMessage([a], b, allowStaff);
    expect(once.map((m) => m.id)).toEqual(["b", "a"]);
    expect(appendStaffChatMessage(once, a, allowStaff)).toBe(once);
  });

  it("あふれるまでは許可リスト外も捨てない（参加したての staff の発言を守る）", () => {
    const kept = appendStaffChatMessage(
      [msg("s1", STAFF, 1)],
      msg("new", STRANGER, 2),
      allowStaff,
    );
    expect(kept.map((m) => m.id)).toEqual(["s1", "new"]);
  });

  it("部外者の野良投稿を上限まで流し込まれても、本物の履歴は押し出されない", () => {
    // 本物100件 ＋ ゴミで上限まで埋める → さらにゴミが来ても消えるのはゴミだけ
    let buf = Array.from({ length: 100 }, (_, i) =>
      msg(`real${i}`, STAFF, i),
    );
    for (let i = 0; i < MESSAGE_BUFFER_MAX - 100; i++) {
      buf = appendStaffChatMessage(buf, msg(`junk${i}`, STRANGER, 1000 + i), allowStaff);
    }
    expect(buf).toHaveLength(MESSAGE_BUFFER_MAX);
    const flooded = appendStaffChatMessage(
      buf,
      msg("junk-final", STRANGER, 9999),
      allowStaff,
    );
    expect(flooded).toHaveLength(MESSAGE_BUFFER_MAX);
    expect(flooded.filter((m) => m.pubkey === STAFF)).toHaveLength(100);
    // 捨てられたのは一番古いゴミ
    expect(flooded.some((m) => m.id === "junk0")).toBe(false);
  });

  it("全員が許可リスト内であふれたら、従来どおり古い側から捨てる", () => {
    let buf = Array.from({ length: MESSAGE_BUFFER_MAX }, (_, i) =>
      msg(`m${i}`, STAFF, i),
    );
    buf = appendStaffChatMessage(buf, msg("newest", STAFF, 10_000), allowStaff);
    expect(buf).toHaveLength(MESSAGE_BUFFER_MAX);
    expect(buf.some((m) => m.id === "m0")).toBe(false);
    expect(buf[buf.length - 1]!.id).toBe("newest");
  });
});
