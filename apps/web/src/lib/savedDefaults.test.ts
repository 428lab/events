import { describe, expect, it } from "vitest";
import {
  SCHEDULE_TEMPLATES,
  SURVEY_TEMPLATES,
  defaultLiveSetContent,
  scheduleTemplates,
  surveyTemplates,
  visualLiveSetContent,
  visualParts,
} from "@eventer/shared";
import { copyScene, newScene, newTextElement } from "./liveScenes.js";
import { newTextElement as newDeckText } from "./deckSlides.js";

/**
 * 保存される既定の文言は、作る人の言語で書く (#364)。
 * 日本語はコードに直書きしていた頃と1文字も変えない（既存のデータ・テストと揃える）。
 */
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
const allText = (v: unknown) => JSON.stringify(v);

describe("保存される既定の文言 (#364)", () => {
  it("英語で作ると、テンプレートと置いたばかりの文字に日本語が残らない。日本語は以前の綴り", () => {
    // 英語: どのテンプレートにも仮名・漢字が残らない（スタイル名「灯り / GLOW」等の固有名は除く）
    const brand = /灯り \/ GLOW|輪郭 \/ SIGNAL|白磁 \/ HAKUJI/g;
    for (const v of [
      scheduleTemplates("en").map((t) => t.items),
      surveyTemplates("en").map((t) => t.questions),
      defaultLiveSetContent("en"),
      visualLiveSetContent("glow", "en"),
      visualLiveSetContent("signal", "en"),
      visualLiveSetContent("hakuji", "en"),
      (["glow", "signal", "hakuji"] as const).map((s) => visualParts(s, "en").map((p) => p.elements)),
      [newScene(2, "en"), newTextElement("en"), newDeckText("en")],
    ]) {
      expect(allText(v).replace(brand, "")).not.toMatch(JAPANESE);
    }
    expect(newScene(2, "en").name).toBe("Scene 3");
    expect(copyScene({ id: "a", name: "Intro", background: "#000", elements: [] }, "en").name).toBe("Copy of Intro");
    expect(scheduleTemplates("en")[0]!.items[2]).toEqual({ title: "LT 1", durationMin: 10, description: "5-minute talk + changeover" });
    // 選択肢は「, 」区切りで編集欄に入るので、英語の選択肢に読点を入れない
    expect(surveyTemplates("en").flatMap((t) => t.questions.flatMap((q) => q.options)).some((o) => o.includes(","))).toBe(false);

    // 日本語（省略時も）: 以前の直書きと同じ
    expect(newScene(2).name).toBe("シーン 3");
    expect(copyScene({ id: "a", name: "開始前", background: "#000", elements: [] }).name).toBe("開始前のコピー");
    expect(newTextElement().text).toBe("テキスト");
    expect(newDeckText().text).toBe("テキスト");
    expect(SCHEDULE_TEMPLATES[0]!.items[1]).toEqual({ title: "オープニング", durationMin: 5, description: "趣旨説明・諸注意" });
    expect(SURVEY_TEMPLATES[1]!.questions[0]).toEqual({ question: "懇親会に参加しますか", qtype: "select", options: ["参加", "不参加"], required: true });
    expect(defaultLiveSetContent().scenes.map((s) => s.name)).toEqual(["開始前待機", "OP", "スライド全画面", "スライド + カメラ", "カメラ全画面", "休憩中", "ED"]);
  });
});
