import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ScoringCriterion } from "@eventer/shared";
import { api } from "../api/client.js";
import { ScoringPanel } from "./ScoringPanel.js";

/** 採点は「採点を保存」でまとめて1回だけ保存する。点数を押すたびには通信しない（オーナー決定 2026-11-08） */
const criteria: ScoringCriterion[] = [
  { id: "c1", eventId: "e", name: "完成度", description: null, sortOrder: 0, maxLevel: 4 },
  { id: "c2", eventId: "e", name: "発想", description: null, sortOrder: 1, maxLevel: 4 },
];

function draw(props: { disabled?: boolean; disabledNote?: string; onDirtyChange?: (entryId: string, dirty: boolean) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ScoringPanel eventId="e" entryId="red" criteria={criteria} myScores={[{ entryId: "red", criterionId: "c1", value: 2 }]} {...props} />
    </QueryClientProvider>,
  );
}
const point = (criterion: string, value: number) =>
  screen.getAllByRole("button", { name: String(value) })[criteria.findIndex((c) => c.name === criterion)];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "put").mockResolvedValue({ ok: true } as never);
  vi.spyOn(api, "get").mockResolvedValue({ scores: [] } as never);
});

it("点数を押しても通信せず、「採点を保存」で変えた項目だけを1回で送る。未保存の表示が出て、保存で消える", async () => {
  const onDirtyChange = vi.fn();
  draw({ onDirtyChange });
  fireEvent.click(point("完成度", 4));
  fireEvent.click(point("発想", 3));
  fireEvent.click(point("完成度", 2)); // 保存済みの値に戻した項目は送らない
  fireEvent.click(point("完成度", 4));
  expect(api.put).not.toHaveBeenCalled();
  expect(screen.getByText("未保存の変更があります")).toBeInTheDocument();
  expect(onDirtyChange).toHaveBeenLastCalledWith("red", true);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "採点を保存" })); });
  expect(api.put).toHaveBeenCalledExactlyOnceWith("/events/e/scores/batch", {
    entryId: "red",
    scores: [{ criterionId: "c1", value: 4 }, { criterionId: "c2", value: 3 }],
  });
  await screen.findByText("保存しました");
  expect(screen.queryByText("未保存の変更があります")).not.toBeInTheDocument();
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith("red", false));
});

it("運営が採点を開始する前は押せず、その理由が出る。保存ボタンも出ない", () => {
  draw({ disabled: true, disabledNote: "運営が採点を開始するまで採点できません。" });
  expect(point("完成度", 4)).toBeDisabled();
  expect(screen.getByText("運営が採点を開始するまで採点できません。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "採点を保存" })).not.toBeInTheDocument();
});

it("表示するエントリーが変わったら（発表の切り替え）、前のエントリーの下書きを次に持ち越さない", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const panel = (entryId: string) => (
    <QueryClientProvider client={client}>
      <ScoringPanel eventId="e" entryId={entryId} criteria={criteria} myScores={[]} />
    </QueryClientProvider>
  );
  const { rerender } = render(panel("red"));
  fireEvent.click(point("完成度", 4));
  expect(screen.getByText("未保存の変更があります")).toBeInTheDocument();
  rerender(panel("blue"));
  expect(screen.queryByText("未保存の変更があります")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "採点を保存" })).toBeDisabled();
  expect(api.put).not.toHaveBeenCalled();
});
