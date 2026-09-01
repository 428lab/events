import { describe, expect, it } from "vitest";
import { fillDayGaps } from "./PreSurveyAccessCard.js";

/** 連続日付の穴埋め (#451 レビュー nit)。サーバーは疎な行だけを返す契約なので、
 * 表示側の穴埋めが日付をまたいだ推移の見た目を決める */
describe("fillDayGaps (#450)", () => {
  it("期間内の抜けた日を 0 で埋める（新しい順のまま）", () => {
    expect(
      fillDayGaps([
        { day: "2026-09-01", views: 3, firstVisits: 2, responses: 1 },
        { day: "2026-08-30", views: 5, firstVisits: 4, responses: 0 },
      ]),
    ).toEqual([
      { day: "2026-09-01", views: 3, firstVisits: 2, responses: 1 },
      { day: "2026-08-31", views: 0, firstVisits: 0, responses: 0 },
      { day: "2026-08-30", views: 5, firstVisits: 4, responses: 0 },
    ]);
  });

  it("月またぎでも連続する。0〜1件はそのまま", () => {
    expect(
      fillDayGaps([
        { day: "2026-09-01", views: 1, firstVisits: 1, responses: 0 },
        { day: "2026-08-31", views: 2, firstVisits: 1, responses: 0 },
      ]).map((r) => r.day),
    ).toEqual(["2026-09-01", "2026-08-31"]);
    expect(fillDayGaps([])).toEqual([]);
    expect(fillDayGaps([{ day: "2026-09-01", views: 1, firstVisits: 1, responses: 0 }])).toHaveLength(1);
  });
});
