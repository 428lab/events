import { describe, it, expect } from "vitest";
import {
  buildChannelCreateTemplate,
  buildChannelMessageTemplate,
  buildChatKeyProofTemplate,
} from "./nostrChat.js";

/**
 * NIP-70 (#460) の回帰テスト。リレーへ発行するイベント（kind:40/42 と、
 * 同じ builder を通るスタッフチャット #382）に `["-"]` が付いていること、
 * リレーへ出ないイベント（所有証明）には付いていないことを守る。
 * これが崩れると、第三者による他リレーへの再放流を仕様レベルで拒否できなくなる
 * （docs/nip70-protected-chat.md）。
 */

const CHANNEL = "ab".repeat(32);
const RELAY = "wss://r.example.com";

describe("リレーへ発行するイベントは protected (#460)", () => {
  it("kind:42（既定）: e タグと [\"-\"] の両方が付く", () => {
    const tmpl = buildChannelMessageTemplate(CHANNEL, "こんにちは", RELAY);
    expect(tmpl.kind).toBe(42);
    expect(tmpl.tags).toContainEqual(["e", CHANNEL, RELAY, "root"]);
    expect(tmpl.tags).toContainEqual(["-"]);
  });

  it("kind 指定（スタッフチャット #382 が通る形）でも [\"-\"] が付く", () => {
    const tmpl = buildChannelMessageTemplate(CHANNEL, "x", RELAY, 9807);
    expect(tmpl.kind).toBe(9807);
    expect(tmpl.tags).toContainEqual(["e", CHANNEL, RELAY, "root"]);
    expect(tmpl.tags).toContainEqual(["-"]);
  });

  it("kind:40（主催者 NIP-07 経路のチャンネル作成）: tags は [\"-\"] のみ", () => {
    const tmpl = buildChannelCreateTemplate("イベント名");
    expect(tmpl.kind).toBe(40);
    expect(tmpl.tags).toEqual([["-"]]);
    expect(JSON.parse(tmpl.content)).toMatchObject({ name: "イベント名" });
  });
});

describe("リレーへ出ないイベントには付けない (#460)", () => {
  it("鍵の所有証明（kind 27888。API へ送るだけ）に [\"-\"] は無い", () => {
    const tmpl = buildChatKeyProofTemplate("challenge-value", "event-id");
    expect(tmpl.tags).not.toContainEqual(["-"]);
  });
});
