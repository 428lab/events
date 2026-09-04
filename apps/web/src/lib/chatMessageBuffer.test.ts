import { describe, it, expect } from "vitest";
import {
  appendChatMessage,
  clampToDisplayMax,
  MESSAGE_BUFFER_MAX,
  MESSAGE_DISPLAY_MAX,
  selectVisibleChatMessages,
} from "./chatMessageBuffer.js";

/**
 * チャットの受信バッファ（イベントチャット #199 とスタッフチャット #382 で共有）。
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

describe("appendChatMessage (#382)", () => {
  it("IDで重複排除し、時刻順に並べる", () => {
    const a = msg("a", STAFF, 100);
    const b = msg("b", STAFF, 50);
    const once = appendChatMessage([a], b, allowStaff);
    expect(once.map((m) => m.id)).toEqual(["b", "a"]);
    expect(appendChatMessage(once, a, allowStaff)).toBe(once);
  });

  it("あふれるまでは許可リスト外も捨てない（参加したての staff の発言を守る）", () => {
    const kept = appendChatMessage(
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
      buf = appendChatMessage(buf, msg(`junk${i}`, STRANGER, 1000 + i), allowStaff);
    }
    expect(buf).toHaveLength(MESSAGE_BUFFER_MAX);
    const flooded = appendChatMessage(
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
    buf = appendChatMessage(buf, msg("newest", STAFF, 10_000), allowStaff);
    expect(buf).toHaveLength(MESSAGE_BUFFER_MAX);
    expect(buf.some((m) => m.id === "m0")).toBe(false);
    expect(buf[buf.length - 1]!.id).toBe("newest");
  });
});

describe("selectVisibleChatMessages (#199 / #215)", () => {
  const note = (id: string, pubkey: string, content: string) => ({
    id,
    pubkey,
    content,
    created_at: 1,
  });
  const members = new Set([STAFF]);

  it("許可リスト外の発言は描かない（部外者が同じチャンネルに流し込める）", () => {
    const kept = selectVisibleChatMessages(
      [note("a", STAFF, "こんにちは"), note("b", STRANGER, "宣伝")],
      { members, hidden: new Set(), maxLength: 10 },
    );
    expect(kept.map((m) => m.id)).toEqual(["a"]);
  });

  it("スタッフが非表示にした発言は描かない", () => {
    const kept = selectVisibleChatMessages([note("a", STAFF, "x")], {
      members,
      hidden: new Set(["a"]),
      maxLength: 10,
    });
    expect(kept).toEqual([]);
  });

  it("上限を超える長さの発言は描かない（外部クライアントからの巨大投稿）", () => {
    const kept = selectVisibleChatMessages(
      [note("a", STAFF, "あ".repeat(11)), note("b", STAFF, "あ".repeat(10))],
      { members, hidden: new Set(), maxLength: 10 },
    );
    expect(kept.map((m) => m.id)).toEqual(["b"]);
  });

  it("表示上限を超えたら新しい側を残す", () => {
    const many = Array.from({ length: MESSAGE_DISPLAY_MAX + 5 }, (_, i) =>
      note(`m${i}`, STAFF, "x"),
    );
    const kept = selectVisibleChatMessages(many, {
      members,
      hidden: new Set(),
      maxLength: 10,
    });
    expect(kept).toHaveLength(MESSAGE_DISPLAY_MAX);
    expect(kept[0]!.id).toBe("m5");
    expect(kept[kept.length - 1]!.id).toBe(`m${MESSAGE_DISPLAY_MAX + 4}`);
  });
});

describe("clampToDisplayMax", () => {
  it("上限以下なら同じ配列をそのまま返す", () => {
    const xs = [1, 2, 3];
    expect(clampToDisplayMax(xs)).toBe(xs);
  });

  it("上限を超えたら末尾（新しい側）だけを残す", () => {
    const xs = Array.from({ length: MESSAGE_DISPLAY_MAX + 2 }, (_, i) => i);
    const kept = clampToDisplayMax(xs);
    expect(kept).toHaveLength(MESSAGE_DISPLAY_MAX);
    expect(kept[0]).toBe(2);
  });
});
