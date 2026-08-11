import { describe, it, expect, afterEach } from "vitest";
import { ApiError, NetworkError } from "../api/client.js";
import { i18next } from "../i18n/index.js";
import { errorCode, errorMessage } from "./errorMessage.js";

/**
 * サーバーの `{ error: "コード" }` を文言にする共通の辞書 (#352)。
 * 画面ごとに分岐を書き足す形へ戻さないための見張り。
 */
afterEach(async () => {
  await i18next.changeLanguage("ja");
});

const apiError = (code: unknown) => new ApiError(400, { error: code });

describe("errorMessage (#352)", () => {
  it("辞書にあるコードは、その言語の文言になる", async () => {
    expect(errorMessage(apiError("event_not_found"))).toBe(
      "イベントが見つかりません",
    );
    await i18next.changeLanguage("en");
    expect(errorMessage(apiError("event_not_found"))).toBe("Event not found.");
  });

  it("辞書に無いコードでも既定の文言が出る（画面が壊れない）", () => {
    const msg = errorMessage(apiError("brand_new_code_from_server"));
    expect(msg).toBe(i18next.t("errors.default"));
    expect(msg).not.toContain("brand_new_code_from_server");
  });

  it("コードが取れない例外も既定の文言に落ちる", () => {
    expect(errorMessage(new Error("boom"))).toBe(i18next.t("errors.default"));
    expect(errorMessage(apiError(undefined))).toBe(i18next.t("errors.default"));
    expect(errorMessage(null)).toBe(i18next.t("errors.default"));
  });

  it("その画面だけの言い方は overrides で上書きできる", () => {
    expect(
      errorMessage(apiError("last_staff"), {
        last_staff: "先に別の人をスタッフにしてください。",
      }),
    ).toBe("先に別の人をスタッフにしてください。");
    // 上書きしていないコードは辞書のまま
    expect(
      errorMessage(apiError("not_found"), { last_staff: "上書き" }),
    ).toBe("見つかりませんでした");
  });

  it("応答が返らなかった場合は、コードとは別の案内にする", () => {
    expect(errorMessage(new NetworkError(false))).toBe(i18next.t("errors.network"));
    expect(errorMessage(new NetworkError(true))).toBe(i18next.t("errors.timeout"));
  });
});

describe("errorCode (#352)", () => {
  it("サーバーのコードを取り出す", () => {
    expect(errorCode(apiError("forbidden"))).toBe("forbidden");
  });

  it("コードでないものは null", () => {
    expect(errorCode(apiError(42))).toBeNull();
    expect(errorCode(new Error("boom"))).toBeNull();
    expect(errorCode(new NetworkError(false))).toBeNull();
  });
});
