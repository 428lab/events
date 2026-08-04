import { describe, it, expect } from "vitest";
import { deriveHandle, sanitizeHandle } from "../src/lib/handle.js";

describe("ハンドルの自動生成 (#236)", () => {
  it("sanitizeHandle: 許可文字はそのまま、許可外は整形、痩せたら null", () => {
    expect(sanitizeHandle("merry shino")).toBe("merry shino");
    expect(sanitizeHandle("kojira_428")).toBe("kojira_428");
    // 許可外文字はスペースに置換して詰める
    expect(sanitizeHandle("John(Doe)")).toBe("John Doe");
    // 全部許可外（漢字のみ）→ null
    expect(sanitizeHandle("近藤昭雄")).toBeNull();
    expect(sanitizeHandle("")).toBeNull();
    expect(sanitizeHandle(null)).toBeNull();
    // 1文字に痩せる → null
    expect(sanitizeHandle("あaい")).toBeNull();
    // 28文字で切り、末尾スペースは落とす
    const long = "a".repeat(27) + " bcd";
    expect(sanitizeHandle(long)).toBe("a".repeat(27));
  });

  it("deriveHandle: 表示名 → メール@前 → user の順でフォールバック", () => {
    expect(deriveHandle("merry shino", "m@example.com")).toBe("merry shino");
    expect(deriveHandle("近藤昭雄", "kondo.akio@example.com")).toBe("kondo.akio");
    expect(deriveHandle("近藤昭雄", null)).toBe("user");
    expect(deriveHandle(null, "あ@example.com")).toBe("user");
    // name にメールアドレスが入ってくるケース（Google の name 欠落時）:
    // 完全なメールアドレスをハンドルに露出させない
    expect(deriveHandle("john.doe@gmail.com", "john.doe@gmail.com")).toBe("john.doe");
    expect(deriveHandle("あ@gmail.com", "fallback.name@example.com")).toBe("fallback.name");
  });
});
