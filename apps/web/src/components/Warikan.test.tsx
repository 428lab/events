import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, WarikanLedger, WarikanMember } from "@eventer/shared";
import { ApiError, api } from "../api/client.js";
import { WarikanSummaryCard } from "./WarikanSummaryCard.js";
import { WarikanExpenseForm } from "./WarikanExpenseForm.js";
import { WarikanPayoutMethods } from "./WarikanPayoutMethods.js";
import { EventWarikanPage } from "../pages/EventWarikanPage.js";

/**
 * 割り勘の画面 (#556 §5.3 の受け入れ条件)。
 * - カードは自分の行のうち「済み」でないものがあるときだけ。差引ではなく相手ごとの行
 *   （最大2行＋「ほか n 件」）。自分が支払う行を先に並べる。全部「済み」なら消える
 * - 精算の行の「済み」: 付けるときは行の額を送る。済みの行は薄く残り、外す操作だけ。409 は案内して取り直す
 * - 帳簿の取得エラーは 404 のときだけ「確定メンバーと当事者だけ」の案内
 * - observer に「立替を追加」が出ない
 * - 新規は「全員」をチェックして開く。プリセットは初期チェックを決めるだけで、後から外せる。
 *   編集で開くとプリセット未選択
 * - 受け取り先に表示名の入力が無く、「銀行口座はこのアプリに保存できません。」が出る
 */

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { id: "e", title: "テストイベント" } } }),
}));
vi.mock("../lib/useEventChatAccess.js", () => ({
  useEventChatAccess: () => ({ chatAvailable: false, canChat: true }),
}));

const member = (userId: string, over: Partial<WarikanMember> = {}): WarikanMember => ({
  userId,
  displayName: userId.toUpperCase(),
  avatarUrl: null,
  role: "participant",
  standing: "confirmed",
  attended: false,
  selectable: true,
  ...over,
});

function ledger(over: Partial<WarikanLedger> = {}): WarikanLedger {
  return {
    members: [member("me"), member("a"), member("b"), member("c"), member("d")],
    expenses: [],
    payoutMethods: [],
    balances: [],
    settlements: [],
    me: { userId: "me", canAddExpense: true, isStaff: false },
    ...over,
  };
}

const settlement = (
  fromUserId: string,
  toUserId: string,
  amount: number,
  over: Partial<WarikanLedger["settlements"][number]> = {},
): WarikanLedger["settlements"][number] => ({
  fromUserId,
  toUserId,
  amount,
  breakdown: [{ kind: "expense" as const, expenseId: "x", amount }],
  done: null,
  canToggle: fromUserId === "me" || toUserId === "me",
  ...over,
});

/** 2026-09-28 12:00 JST */
const MARKED_AT = Date.UTC(2026, 8, 28, 3, 0, 0);

function withProviders(ui: React.ReactNode, path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("割り勘カード", () => {
  it("自分の行が無ければ何も出さない", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(
      ledger({ settlements: [settlement("a", "b", 500)] }) as never,
    );
    const { container } = withProviders(<WarikanSummaryCard eventId="e" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/events/e/warikan"));
    expect(container).toBeEmptyDOMElement();
  });

  it("相手ごとの行を支払う行から最大2行、残りは「ほか n 件」で出す（差引は出さない）", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      ledger({
        settlements: [
          settlement("me", "a", 800),
          settlement("b", "me", 200),
          settlement("me", "c", 100),
          settlement("d", "me", 50),
        ],
      }) as never,
    );
    withProviders(<WarikanSummaryCard eventId="e" />);
    expect(await screen.findByText("A さんに 800円 支払う")).toBeInTheDocument();
    expect(screen.getByText("C さんに 100円 支払う")).toBeInTheDocument();
    expect(screen.queryByText(/B さん/)).toBeNull();
    expect(screen.getByText("ほか 2 件")).toBeInTheDocument();
    expect(screen.queryByText(/650円/)).toBeNull();
    expect(screen.getByRole("link", { name: "割り勘を開く" })).toHaveAttribute(
      "href",
      "/events/e/warikan",
    );
  });

  it("「済み」の行は数えない。全部「済み」ならカードを出さない", async () => {
    const done = { markedBy: "me", markedAt: MARKED_AT };
    const get = vi.spyOn(api, "get").mockResolvedValue(
      ledger({
        settlements: [settlement("me", "a", 800, { done }), settlement("b", "me", 200, { done })],
      }) as never,
    );
    const { container } = withProviders(<WarikanSummaryCard eventId="e" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("「ほか n 件」は済みでない行だけを数える", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      ledger({
        settlements: [
          settlement("me", "a", 800),
          settlement("me", "b", 300, { done: { markedBy: "b", markedAt: MARKED_AT } }),
          settlement("me", "c", 100),
          settlement("d", "me", 50),
        ],
      }) as never,
    );
    withProviders(<WarikanSummaryCard eventId="e" />);
    expect(await screen.findByText("A さんに 800円 支払う")).toBeInTheDocument();
    expect(screen.getByText("C さんに 100円 支払う")).toBeInTheDocument();
    expect(screen.queryByText(/B さん/)).toBeNull();
    expect(screen.getByText("ほか 1 件")).toBeInTheDocument();
  });

  it("帳簿の GET が 404（帳簿を見られない人）なら黙って何も出さない", async () => {
    const get = vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, { error: "not_found" }));
    const { container } = withProviders(<WarikanSummaryCard eventId="e" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("割り勘ページ", () => {
  function drawPage(l: WarikanLedger) {
    vi.spyOn(api, "get").mockResolvedValue(l as never);
    return withProviders(
      <Routes>
        <Route path="/events/:id/warikan" element={<EventWarikanPage />} />
      </Routes>,
      "/events/e/warikan",
    );
  }

  it("observer には「立替を追加」が出ない", async () => {
    drawPage(ledger({ me: { userId: "me", canAddExpense: false, isStaff: false } }));
    expect(await screen.findByText("立替の一覧")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立替を追加" })).toBeNull();
  });

  it("確定メンバーには「立替を追加」が出て、免責バナーは常に出る", async () => {
    drawPage(ledger());
    expect(await screen.findByRole("button", { name: "立替を追加" })).toBeInTheDocument();
    expect(
      screen.getByText(/お金のやりとりは当事者どうしで行います。このアプリはお金を預かりません。/),
    ).toBeInTheDocument();
    expect(screen.getByText("あなたの精算はありません")).toBeInTheDocument();
  });

  it("受け取り先が無い相手に払う行は、固定文を出す（「精算する」も記録のボタンも出さない）", async () => {
    drawPage(ledger({ settlements: [settlement("me", "a", 800)] }));
    expect(await screen.findByText("A さんに 800円")).toBeInTheDocument();
    expect(screen.getByText(/受け取り先が登録されていません。/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /記録/ })).toBeNull();
    expect(screen.queryByText(/精算する/)).toBeNull();
  });

  it("帳簿の取得が 404 なら「確定メンバーと当事者だけ」の案内、それ以外は汎用のエラー", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, { error: "not_found" }));
    const first = withProviders(
      <Routes>
        <Route path="/events/:id/warikan" element={<EventWarikanPage />} />
      </Routes>,
      "/events/e/warikan",
    );
    expect(await screen.findByText(/立替の当事者だけが見られます/)).toBeInTheDocument();
    first.unmount();

    vi.spyOn(api, "get").mockRejectedValue(new ApiError(500, { error: "internal" }));
    withProviders(
      <Routes>
        <Route path="/events/:id/warikan" element={<EventWarikanPage />} />
      </Routes>,
      "/events/e/warikan",
    );
    expect(await screen.findByText("読み込めませんでした。再読み込みしてください。")).toBeInTheDocument();
    expect(screen.queryByText(/立替の当事者だけが見られます/)).toBeNull();
  });

  it("見出しの下に自己申告の1行を出す（「管理しません」の旧文言は出さない）", async () => {
    drawPage(ledger({ settlements: [settlement("me", "a", 800)] }));
    expect(
      await screen.findByText("「済み」は当事者の自己申告です。このアプリは支払いを確認しません。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/管理しません/)).toBeNull();
  });

  it("「済み」を付けると行の額を PUT で送る", async () => {
    drawPage(ledger({ settlements: [settlement("me", "a", 800)] }));
    const put = vi.spyOn(api, "put").mockResolvedValue({ done: { markedBy: "me", markedAt: 1 } } as never);
    fireEvent.click(await screen.findByRole("checkbox", { name: "済み" }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/events/e/warikan/settlements/me/a/done", { amount: 800 }),
    );
  });

  it("409 amount_changed なら案内を出して取り直す", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(
      ledger({ settlements: [settlement("me", "a", 800)] }) as never,
    );
    withProviders(
      <Routes>
        <Route path="/events/:id/warikan" element={<EventWarikanPage />} />
      </Routes>,
      "/events/e/warikan",
    );
    vi.spyOn(api, "put").mockRejectedValue(new ApiError(409, { error: "amount_changed" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "済み" }));
    expect(await screen.findByText("金額が変わりました。最新の内容を表示します")).toBeInTheDocument();
    await waitFor(() =>
      expect(get.mock.calls.filter(([p]) => p === "/events/e/warikan").length).toBeGreaterThan(1),
    );
  });

  it("済みの行は後ろに薄く残り、誰がいつ付けたかと外すチェックだけが出る", async () => {
    drawPage(
      ledger({
        settlements: [
          settlement("me", "a", 800, { done: { markedBy: "a", markedAt: MARKED_AT } }),
          settlement("me", "b", 300),
        ],
      }),
    );
    const doneLine = await screen.findByText("済み（A さんが 9/28 に記録）");
    const pending = screen.getByText("B さんに 300円");
    expect(pending.compareDocumentPosition(doneLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox", { name: "済み" });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true]);
    // 金額のコピーは済みでない行だけ。グループの合計も済みでない行だけ
    expect(screen.getAllByRole("button", { name: "金額をコピー" })).toHaveLength(1);
    expect(screen.getByText("あなたが支払う（1件・合計 300円）")).toBeInTheDocument();

    const del = vi.spyOn(api, "del").mockResolvedValue({ ok: true } as never);
    fireEvent.click(boxes[1]!);
    await waitFor(() => expect(del).toHaveBeenCalledWith("/events/e/warikan/settlements/me/a/done"));
  });

  it("canToggle が false の行にはチェックを出さない", async () => {
    drawPage(ledger({ settlements: [settlement("me", "a", 800, { canToggle: false })] }));
    expect(await screen.findByText("A さんに 800円")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "済み" })).toBeNull();
  });

  it("支払う行 → 受け取る行の2グループで、金額のコピーは支払う行だけ", async () => {
    drawPage(
      ledger({ settlements: [settlement("b", "me", 200), settlement("me", "a", 800)] }),
    );
    const pay = await screen.findByText("あなたが支払う（1件・合計 800円）");
    const receive = screen.getByText("あなたが受け取る（1件・合計 200円）");
    expect(pay.compareDocumentPosition(receive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "金額をコピー" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /記録/ })).toBeNull();
  });
});

describe("立替フォーム", () => {
  const event = { id: "e", scheduling: false, startsAt: 0, attendanceCheck: true } as Event;

  it("新規は「全員」をチェックして開き、個別に外せる", () => {
    const l = ledger({
      members: [member("me", { attended: true }), member("a", { attended: true }), member("b")],
    });
    withProviders(
      <WarikanExpenseForm eventId="e" event={event} ledger={l} open onClose={() => {}} />,
    );
    expect(screen.getByRole("checkbox", { name: "ME" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B" })).toBeChecked();
    // 金額が未入力のうちは「1人あたり約 0円」を出さない
    expect(screen.queryByText(/1人あたり/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/金額（円）/), { target: { value: "900" } });
    expect(screen.getByText("3 人・1人あたり約 300円")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "B" }));
    expect(screen.getByRole("checkbox", { name: "B" })).not.toBeChecked();
    expect(screen.getByText(/^2 人・/)).toBeInTheDocument();

    // 出席した人: 出席した participant だけ
    fireEvent.click(screen.getByRole("button", { name: "出席した人" }));
    expect(screen.getByRole("checkbox", { name: "ME" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "全員" }));
    expect(screen.getByRole("checkbox", { name: "B" })).toBeChecked();
  });

  it("重みの欄は空にしてから打ち直せる。重み 1・2・1 の 1,000円は「重み 1 あたり約 250円」", () => {
    const l = ledger({ members: [member("me"), member("a"), member("b")] });
    withProviders(
      <WarikanExpenseForm eventId="e" event={event} ledger={l} open onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/金額（円）/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "詳細" }));
    const weightA = screen.getByLabelText("重み A");
    fireEvent.change(weightA, { target: { value: "" } });
    expect(weightA).toHaveValue("");
    fireEvent.change(weightA, { target: { value: "2" } });
    expect(weightA).toHaveValue("2");
    expect(screen.getByText("3 人・重み 1 あたり約 250円")).toBeInTheDocument();
  });

  it("重みの欄を空のまま保存すると 1 として送る", async () => {
    const l = ledger({ members: [member("me"), member("a")] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ expense: { id: "x" } } as never);
    withProviders(
      <WarikanExpenseForm eventId="e" event={event} ledger={l} open onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/金額（円）/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "会場費" } });
    fireEvent.click(screen.getByRole("button", { name: "詳細" }));
    fireEvent.change(screen.getByLabelText("重み A"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0]![1] as { shares: unknown }).shares).toEqual([
      { userId: "me", weight: 1 },
      { userId: "a", weight: 1 },
    ]);
  });

  it("出席チェックがオフのイベントでは「出席した人」を出さない", () => {
    withProviders(
      <WarikanExpenseForm
        eventId="e"
        event={{ ...event, attendanceCheck: false }}
        ledger={ledger()}
        open
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "全員" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "出席した人" })).toBeNull();
  });

  it("編集で開くとプリセット未選択で、保存済みの負担者（取消した人を含む）がチェックされている", () => {
    const l = ledger({
      members: [
        member("me"),
        member("a"),
        member("b"),
        member("gone", { standing: "former", selectable: false }),
      ],
    });
    const expense = {
      id: "x",
      payerUserId: "me",
      amount: 900,
      title: "会場費",
      note: "",
      spentOn: null,
      createdBy: "me",
      createdAt: 1,
      updatedAt: 1,
      shares: [
        { userId: "me", weight: 1, amount: 300 },
        { userId: "gone", weight: 1, amount: 300 },
        { userId: "a", weight: 1, amount: 300 },
      ],
      remainder: 0,
      absorbedByPayer: 0,
      canEdit: true,
    };
    withProviders(
      <WarikanExpenseForm eventId="e" event={event} ledger={l} expense={expense} open onClose={() => {}} />,
    );
    expect(screen.getByText("立替を編集")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ME" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "GONE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B" })).not.toBeChecked();
  });
});

describe("自分の受け取り先", () => {
  it("表示名の入力が無く、銀行口座の固定文が出る", () => {
    withProviders(<WarikanPayoutMethods eventId="e" ledger={ledger()} />);
    const card = screen.getByText("自分の受け取り先").closest(".MuiCard-root") as HTMLElement;
    // 入力は種別の選択と値の2つだけ（表示名の欄を持たない）
    expect(within(card).getAllByRole("textbox")).toHaveLength(1);
    expect(within(card).queryByLabelText(/表示名|名前|ラベル/)).toBeNull();
    expect(within(card).getByText("銀行口座はこのアプリに保存できません。")).toBeInTheDocument();
    expect(within(card).getByText("あなたにお金を返す人に表示されます")).toBeInTheDocument();
  });

  it("保存に成功したら「保存しました」を出す", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ payoutMethods: [] } as never);
    withProviders(<WarikanPayoutMethods eventId="e" ledger={ledger()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "受け取り用リンク" }), {
      target: { value: "https://paypay.ne.jp/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "受け取り先を追加" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(await screen.findByText("保存しました")).toBeInTheDocument();
  });

  it("種別は受け取り用リンクと Lightning の2つだけ", () => {
    withProviders(<WarikanPayoutMethods eventId="e" ledger={ledger()} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["受け取り用リンク", "Lightning アドレス"]);
  });
});
