import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client.js";
import {
  chatChannelErrorKey,
  chatErrorIs,
  chatJoinErrorKey,
  isChatUnavailable,
} from "./chatApiErrors.js";

/**
 * チャットAPIの失敗の読み方 (#283 / #332)。
 *
 * 守るのは「同じ status でも error 名で説明を出し分ける」こと。
 * 利用者のすることが違う（別の鍵を使う / 鍵を減らす / 何もできない）ので、
 * status だけで束ねるとどれかが的外れになる。
 */

function apiError(status: number, code?: string) {
  return new ApiError(status, code ? { error: code } : null);
}

describe("chatErrorIs", () => {
  it("status と error 名の両方が一致したときだけ真", () => {
    expect(chatErrorIs(apiError(403, "chat_unavailable"), 403, "chat_unavailable")).toBe(true);
    // 別のエンドポイントが同じ error 名を別の status で返しても吸い込まない
    expect(chatErrorIs(apiError(404, "chat_unavailable"), 403, "chat_unavailable")).toBe(false);
    expect(chatErrorIs(apiError(403, "key_not_linked"), 403, "chat_unavailable")).toBe(false);
    expect(chatErrorIs(new Error("network"), 403, "chat_unavailable")).toBe(false);
  });
});

describe("isChatUnavailable (#283)", () => {
  it("403 + chat_unavailable だけを繋がせない状態とみなす", () => {
    expect(isChatUnavailable(apiError(403, "chat_unavailable"))).toBe(true);
    expect(isChatUnavailable(apiError(403, "not_confirmed"))).toBe(false);
    expect(isChatUnavailable(apiError(500, "chat_unavailable"))).toBe(false);
    expect(isChatUnavailable(null)).toBe(false);
  });
});

describe("chatJoinErrorKey", () => {
  it("鍵の衝突は、本人の鍵を使ったときだけ「別の鍵を」と言う", () => {
    const err = apiError(409, "pubkey_taken");
    expect(chatJoinErrorKey(err, true)).toBe("eventSocial.chatJoinKeyTaken");
    // 一時鍵は利用者が選んでいないので、別の鍵を選べとは言えない
    expect(chatJoinErrorKey(err, false)).toBe("eventSocial.chatJoinFailedRetry");
  });

  it("締め出しは、参加が確定していない旨の文言に落とさない (#283)", () => {
    expect(chatJoinErrorKey(apiError(403, "chat_unavailable"), false)).toBe(
      "eventSocial.chatUnavailable",
    );
  });

  it("同じ 409 でも鍵の上限は別の文言 (#332)", () => {
    expect(chatJoinErrorKey(apiError(409, "too_many_keys"), true)).toBe(
      "eventSocial.chatJoinTooManyKeys",
    );
  });

  it("鍵がアカウントに未登録なら専用の文言 (#332)", () => {
    expect(chatJoinErrorKey(apiError(403, "key_not_linked"), true)).toBe(
      "eventSocial.chatJoinKeyNotLinked",
    );
  });

  it("上記以外の 403 は従来どおり参加確定前の案内", () => {
    expect(chatJoinErrorKey(apiError(403, "forbidden"), false)).toBe(
      "eventSocial.chatJoinNotConfirmed",
    );
  });

  it("分からない失敗は一般の文言", () => {
    expect(chatJoinErrorKey(new Error("boom"), false)).toBe(
      "eventSocial.chatJoinFailed",
    );
    expect(chatJoinErrorKey(apiError(500), true)).toBe(
      "eventSocial.chatJoinFailed",
    );
  });
});

describe("chatChannelErrorKey (#199)", () => {
  it("503（サービス鍵が無い）と 502（リレーに拒否された）を分ける", () => {
    expect(chatChannelErrorKey(apiError(503))).toBe(
      "eventSocial.chatChannelCreateNoServiceKey",
    );
    expect(chatChannelErrorKey(apiError(502))).toBe(
      "eventSocial.chatChannelCreateRejected",
    );
    expect(chatChannelErrorKey(apiError(500))).toBe(
      "eventSocial.chatChannelCreateFailed",
    );
    expect(chatChannelErrorKey(new Error("channel_not_settled"))).toBe(
      "eventSocial.chatChannelCreateFailed",
    );
  });
});
