import { describe, expect, it } from "vitest";
import { surveyValueLabel } from "@eventer/shared";
import { CSV_BOM, escapeCsvField, toCsv, downloadCsv } from "./csv.js";

/**
 * CSV 生成 (#447)。RFC 4180 のエスケープと BOM を固定する
 * （Excel の文字化け・列ずれは配布後にしか気づけないので、契約をテストで持つ）。
 */
describe("CSV 生成 (#447)", () => {
  it("カンマ・改行・ダブルクォートを含むフィールドをエスケープする", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(toCsv([["a,b", 'q"t'], ["x", "y"]])).toBe('"a,b","q""t"\r\nx,y');
  });

  it("数式インジェクション対策: 先頭の = + - @ TAB CR に ' を前置する", () => {
    expect(escapeCsvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvField("+81-90-0000")).toBe("'+81-90-0000");
    expect(escapeCsvField("-1")).toBe("'-1");
    expect(escapeCsvField("@cmd")).toBe("'@cmd");
    expect(escapeCsvField("\t=1")).toBe("'\t=1");
    // 前置後にカンマ等があれば通常どおりクォートもされる
    expect(escapeCsvField("=1,2")).toBe(`"'=1,2"`);
    // 文中の = は無害なのでそのまま
    expect(escapeCsvField("a=b")).toBe("a=b");
  });

  it("複数選択（checkbox の保存値）は surveyValueLabel の「、」連結をそのまま1セルにする", () => {
    const cell = surveyValueLabel("checkbox", JSON.stringify(["開発", "雑談"]));
    expect(cell).toBe("開発、雑談");
    expect(toCsv([[cell]])).toBe("開発、雑談"); // 読点はカンマではないので囲まれない
  });

  it("ダウンロードは UTF-8 BOM 付きの Blob を作る", async () => {
    expect(CSV_BOM).toBe("﻿");
    let captured: Blob | null = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      captured = b;
      return "blob:test";
    };
    URL.revokeObjectURL = () => {};
    try {
      downloadCsv("test.csv", [["名前", "値"], ["a,b", "c"]]);
    } finally {
      URL.createObjectURL = orig;
    }
    expect(captured).not.toBeNull();
    // BOM の確認は**生バイト**で行う。readAsText は UTF-8 デコード時に BOM を
    // 剥がすので、文字列比較では「付いていない」と区別できない
    const buf = await new Promise<ArrayBuffer>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.readAsArrayBuffer(captured!);
    });
    const bytes = new Uint8Array(buf);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const body = new TextDecoder().decode(bytes.subarray(3));
    expect(body).toBe('名前,値\r\n"a,b",c');
  });
});
