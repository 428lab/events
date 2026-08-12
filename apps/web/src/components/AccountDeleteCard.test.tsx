import { describe, it, expect, afterEach } from "vitest";
import { i18next } from "../i18n/index.js";
import { formatGrace } from "./AccountDeleteCard.js";

/**
 * 退会の猶予期間の表し方 (#357)。
 *
 * 猶予期間は環境で変わり、staging は検証用に短い（1日・1分もありうる）。
 * 単数のときに英語で "1 days" / "1 minutes" と出ていたので、単数と複数で
 * 辞書のキーを分けた。ここは**数だけで綴りが決まる**ことを両方の言語で見張る。
 */

const ONE_DAY = 86_400_000;
const ONE_MINUTE = 60_000;

// 言語を英語に切り替えるテストがあるので、毎回日本語に戻す
// （test/setup.ts の beforeEach も効くが、このファイルの中で切り替えたまま
//   次のファイルへ渡さないことを明示しておく）
afterEach(async () => {
  await i18next.changeLanguage("ja");
});

describe("猶予期間の表示 (#357)", () => {
  it("日本語は単数でも複数でも同じ綴りで出る", () => {
    expect(formatGrace(ONE_DAY)).toBe("1日");
    expect(formatGrace(30 * ONE_DAY)).toBe("30日");
    expect(formatGrace(ONE_MINUTE)).toBe("1分");
    expect(formatGrace(30 * ONE_MINUTE)).toBe("30分");
  });

  it('英語は1のとき単数になる（"1 days" にならない）', async () => {
    await i18next.changeLanguage("en");
    expect(formatGrace(ONE_DAY)).toBe("1 day");
    expect(formatGrace(30 * ONE_DAY)).toBe("30 days");
    expect(formatGrace(ONE_MINUTE)).toBe("1 minute");
    expect(formatGrace(30 * ONE_MINUTE)).toBe("30 minutes");
  });
});
