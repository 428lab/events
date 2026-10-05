import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SurveyQuestion } from "@eventer/shared";
import { i18next } from "../i18n/index.js";

/** 写真NG（No photo）のプリセット質問 (D-NOPHOTO): 編集画面のスイッチと、参加者の回答フォーム */

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));
vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => getMock(...a), put: (...a: unknown[]) => putMock(...a) } };
});

const { SurveyQuestionsEditor } = await import("./SurveyQuestionsEditor.js");
const { SurveyAnswerDialog } = await import("./SurveyAnswerDialog.js");

const EVENT = "event-1";
const preset: SurveyQuestion = {
  id: "q-photo", eventId: EVENT, phase: "pre", question: "写真への写り込みを避けたいですか？",
  qtype: "select", options: ["ok", "no_photo"], required: true, sortOrder: 0, preset: "no_photo",
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => { getMock.mockReset(); putMock.mockReset(); });

describe("SurveyQuestionsEditor: 写真NGスイッチ", () => {
  it("ON で種類だけ送る（文言・選択肢・必須はサーバーが決める）", async () => {
    let questions: SurveyQuestion[] = [];
    const answers: unknown[] = [];
    getMock.mockImplementation((path: string) => path.endsWith("/survey")
      ? Promise.resolve({ questions }) : Promise.resolve({ questions, rows: answers }));
    putMock.mockImplementation((_path: string, body: { questions: unknown[] }) => {
      questions = body.questions.length ? [preset] : [];
      return Promise.resolve({ questions });
    });
    wrap(<SurveyQuestionsEditor eventId={EVENT} />);
    const toggle = await screen.findByRole("checkbox", { name: "写真NG（No photo）の希望を聞く" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(screen.getByText(/写真への写り込みを避けたいですか？ \*/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "アンケートを保存" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(`/events/${EVENT}/survey`, { questions: [{ preset: "no_photo" }] }));
  });

  it("回答が集まったプリセットを外すときは確認し、キャンセルなら残す", async () => {
    getMock.mockImplementation((path: string) => path.endsWith("/survey")
      ? Promise.resolve({ questions: [preset] })
      : Promise.resolve({ questions: [preset], rows: [{ user: { id: "u" }, memberStatus: "confirmed", answers: { [preset.id]: "no_photo" } }] }));
    putMock.mockResolvedValue({ questions: [] });
    wrap(<SurveyQuestionsEditor eventId={EVENT} />);
    const sw = () => screen.getByRole("checkbox", { name: "写真NG（No photo）の希望を聞く" });
    await screen.findByText(/すでに回答が集まっています/);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      fireEvent.click(sw());
      expect(confirm).toHaveBeenCalledWith("写真NGの質問を外しますか？（保存すると集まった回答も削除されます）");
      expect(sw()).toBeChecked();
      confirm.mockReturnValue(true);
      fireEvent.click(sw());
      expect(sw()).not.toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "アンケートを保存" }));
      await waitFor(() => expect(putMock).toHaveBeenLastCalledWith(`/events/${EVENT}/survey`, { questions: [] }));
    } finally { confirm.mockRestore(); }
  });

  it("保存済みのプリセットは id 付きで送り直す（回答を保持する）", async () => {
    getMock.mockImplementation((path: string) => path.endsWith("/survey")
      ? Promise.resolve({ questions: [preset] }) : Promise.resolve({ questions: [preset], rows: [] }));
    putMock.mockResolvedValue({ questions: [preset] });
    wrap(<SurveyQuestionsEditor eventId={EVENT} />);
    expect(await screen.findByRole("checkbox", { name: "写真NG（No photo）の希望を聞く" })).toBeChecked();
    // 通常の質問の一覧には出さない（文言を編集させない）
    expect(screen.queryByRole("textbox", { name: "質問" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "アンケートを保存" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(`/events/${EVENT}/survey`, { questions: [{ id: "q-photo", preset: "no_photo" }] }));
  });
});

describe("SurveyAnswerDialog: 写真NGは閲覧者の言語で、保存値は ok / no_photo", () => {
  it.each([
    ["ja", "写真への写り込みを避けたいですか？ *", "撮影OK", "写真NG（No photo）"],
    ["en", "Do you prefer not to be photographed? *", "Photos OK", "No photo"],
  ])("%s", async (language, question, ok, no) => {
    await i18next.changeLanguage(language);
    getMock.mockResolvedValue({ answers: [] });
    putMock.mockResolvedValue({ answers: [] });
    wrap(<SurveyAnswerDialog eventId={EVENT} questions={[preset]} open onClose={() => {}} submitLabel="send" />);
    expect(await screen.findByText(question)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: ok })).toBeInTheDocument();
    // 必須: 未選択では送らない
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(putMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: no }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(`/events/${EVENT}/survey/my`, {
      answers: [{ questionId: "q-photo", value: "no_photo" }],
    }));
  });
});
