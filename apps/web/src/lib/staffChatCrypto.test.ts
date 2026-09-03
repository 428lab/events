import { describe, it, expect } from "vitest";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import {
  latestKey,
  openStaffChatMessage,
  sealStaffChatMessage,
  visibleAfterRevocation,
} from "./staffChatCrypto.js";

/**
 * スタッフチャットの暗号化まわり (#382 設計 11.8 / 11.9)。
 *
 * NIP-44 そのものの正しさは nostr-tools（監査済み実装）に任せる。ここで守るのは
 * **使い方**: 暗号化→復号が往復すること、別の鍵では開けないこと、
 * v タグの世代で鍵を引くこと、失効した人の新しい発言が描画対象から外れること。
 */

const RELAY = "wss://r.example.com";
const ROOM = "ab".repeat(32);

function hexKey(fill: number): string {
  return fill.toString(16).padStart(2, "0").repeat(32);
}

describe("暗号化→復号の往復 (#382 11.8)", () => {
  it("最新の鍵で封をして、同じ鍵束で開けられる", () => {
    const keys = [
      { version: 1, secret: hexKey(1) },
      { version: 2, secret: hexKey(2) },
    ];
    const tmpl = sealStaffChatMessage(ROOM, keys, "公開前の相談ごと", RELAY)!;
    expect(tmpl.kind).toBe(GROUP_CHAT_KIND);
    expect(tmpl.tags).toContainEqual(["e", ROOM, RELAY, "root"]);
    expect(tmpl.tags).toContainEqual(["-"]); // kind 9807 も protected (#460)
    expect(tmpl.tags).toContainEqual(["v", "2"]); // 常に最新 version
    expect(tmpl.content).not.toContain("公開前の相談ごと"); // 平文が漏れていない
    expect(openStaffChatMessage(keys, tmpl)).toBe("公開前の相談ごと");
  });

  it("鍵束の並び順に関わらず最新 version で封をする", () => {
    // サーバーは version 昇順で返すが、並びを信じて末尾を取ると
    // 取得の変化で黙って旧世代（抜けた人も読める鍵）に戻る。値で選ぶこと
    const unordered = [
      { version: 3, secret: hexKey(3) },
      { version: 1, secret: hexKey(1) },
      { version: 2, secret: hexKey(2) },
    ];
    expect(latestKey(unordered)!.version).toBe(3);
    const tmpl = sealStaffChatMessage(ROOM, unordered, "x", RELAY)!;
    expect(tmpl.tags).toContainEqual(["v", "3"]);
  });

  it("鍵が1つも無ければ封をできない（null）", () => {
    expect(sealStaffChatMessage(ROOM, [], "x", RELAY)).toBeNull();
  });

  it("別の鍵では復号できない（ローテーション後、抜けた人の鍵では開けない）", () => {
    const v2Keys = [{ version: 2, secret: hexKey(2) }];
    const sealed = sealStaffChatMessage(ROOM, v2Keys, "新しい世代の相談", RELAY)!;
    // 同じ version 番号でも中身が違う鍵（＝抜けた人が推測で作った鍵）では開けない
    const wrong = [{ version: 2, secret: hexKey(9) }];
    expect(openStaffChatMessage(wrong, sealed)).toBeNull();
    // 旧世代しか持っていない人（v タグの version が手元に無い）も開けない
    const oldOnly = [{ version: 1, secret: hexKey(1) }];
    expect(openStaffChatMessage(oldOnly, sealed)).toBeNull();
  });

  it("v タグの version で鍵を引く（旧世代の過去ログも全世代あれば読める）", () => {
    const v1Keys = [{ version: 1, secret: hexKey(1) }];
    const oldMessage = sealStaffChatMessage(ROOM, v1Keys, "旧世代の発言", RELAY)!;
    // **引きたい鍵を先頭以外に置く**: 位置（keys[0] 等）で引く実装だと、
    // ここで別の鍵に当たって復号に失敗する（v タグで引いている証拠になる）
    const all = [
      { version: 2, secret: hexKey(2) },
      { version: 1, secret: hexKey(1) },
    ];
    expect(openStaffChatMessage(all, oldMessage)).toBe("旧世代の発言");
  });

  it("開けないものは null（v タグ無し・壊れた暗号文・巨大な投稿）", () => {
    const keys = [{ version: 1, secret: hexKey(1) }];
    const sealed = sealStaffChatMessage(ROOM, keys, "x", RELAY)!;
    // v タグ無し（外部クライアントからの野良投稿）
    expect(
      openStaffChatMessage(keys, { content: sealed.content, tags: [] }),
    ).toBeNull();
    // 壊れた暗号文
    expect(
      openStaffChatMessage(keys, { content: "not-nip44", tags: sealed.tags }),
    ).toBeNull();
    // 巨大な投稿には復号を試みない
    expect(
      openStaffChatMessage(keys, {
        content: "A".repeat(5000),
        tags: sealed.tags,
      }),
    ).toBeNull();
  });
});

describe("失効した人の発言の描画 (#382 11.9)", () => {
  const revokedAtMs = 1_700_000_000_000;

  it("revoked_at より後に作られたメッセージは描画対象から外れる", () => {
    const afterSec = Math.floor(revokedAtMs / 1000) + 60;
    expect(visibleAfterRevocation(revokedAtMs, afterSec)).toBe(false);
  });

  it("revoked_at 以前のメッセージ（在籍中の発言）は残る", () => {
    const beforeSec = Math.floor(revokedAtMs / 1000) - 60;
    expect(visibleAfterRevocation(revokedAtMs, beforeSec)).toBe(true);
  });

  it("現役（revokedAt が null）の発言は常に描画対象", () => {
    expect(visibleAfterRevocation(null, Math.floor(Date.now() / 1000))).toBe(
      true,
    );
  });
});
