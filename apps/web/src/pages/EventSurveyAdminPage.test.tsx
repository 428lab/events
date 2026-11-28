import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client.js";

/** 参加アンケートの運営ページ（オーナー 2026-11-28「アクセス統計からしかアンケートが確認できないからページを独立させるべき」）。
 * 質問の編集と回答の一覧が1か所にあり、運営ページからも入れる */
vi.mock("../api/hooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/hooks.js")>()),
  useEvent: () => ({ data: { event: { id: "e1", title: "交流会" }, myRole: "staff" } }),
  useIsAdmin: () => false,
}));
const { EventSurveyAdminPage } = await import("./EventSurveyAdminPage.js");
const { EventManagementLinks } = await import("../components/EventManagementLinks.js");

const question = { id: "q1", eventId: "e1", phase: "registration", question: "所属", qtype: "text", options: [], required: false, sortOrder: 0, preset: null };
let answers: { questions: unknown[]; rows: unknown[] };

function wrap(ui: React.ReactNode, path = "/events/e1/survey") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/events/:id/survey" element={ui} /><Route path="*" element={ui} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  answers = { questions: [question], rows: [{ user: { id: "u1", username: "aoi", globalName: "あおい" }, memberStatus: "confirmed", answers: { q1: "四谷ラボ" } }] };
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path === "/events/e1/survey") return { questions: answers.questions } as never;
    if (path === "/events/e1/survey/answers") return answers as never;
    return { count: 0 } as never;
  });
});

it("質問の編集と回答の一覧が同じページにあり、開催前アンケートへのリンクもある", async () => {
  wrap(<EventSurveyAdminPage />);
  expect(await screen.findByText("あおい")).toBeTruthy();
  expect(screen.getByText("四谷ラボ")).toBeTruthy();
  // 質問の編集（SurveyQuestionsEditor）
  expect(await screen.findByDisplayValue("所属")).toBeTruthy();
  expect(screen.getByRole("link", { name: "開催前アンケートへ" })).toHaveAttribute("href", "/events/e1/pre-survey");
});

it("質問がまだ無いときは、回答の欄に「質問がまだありません」を出す", async () => {
  answers = { questions: [], rows: [] };
  wrap(<EventSurveyAdminPage />);
  expect(await screen.findByText(/質問がまだありません/)).toBeTruthy();
});

it("運営ページのボタンに「参加アンケート」と「開催前アンケート」が並ぶ", () => {
  const { container } = wrap(<EventManagementLinks eventId="e1" isStaff attendanceCheck chatAvailable />, "/events/e1/manage");
  expect(within(container).getByRole("link", { name: "参加アンケート" })).toHaveAttribute("href", "/events/e1/survey");
  expect(within(container).getByRole("link", { name: "開催前アンケート" })).toHaveAttribute("href", "/events/e1/pre-survey");
});
