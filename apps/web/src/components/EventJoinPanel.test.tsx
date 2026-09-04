import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Event, ParticipationSlot } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { EventJoinPanel } from "./EventJoinPanel.js";
import type { EventTiming } from "../lib/useEventTiming.js";

/**
 * 参加操作のうち、分岐が入り組んでいるところ (#152 #269)。
 *
 * 1. 事前アンケートの挟み込み。参加の入口が2つ（ボタンと参加枠）あり、どちらから
 *    でも「先に回答 → 回答後にその枠で参加」になること。
 * 2. サーバーに断られたときの立て直し。締切・終了をまたいだページから押すと 409 が
 *    返るので、無反応にせず理由を出し、時計を進めて表示を切り替えること。
 *    必須アンケート未回答 (409) だけは理由ではなくダイアログで受けること。
 */

const {
  joinMutate,
  leaveMutate,
  membersMock,
  slotsMock,
  surveyMock,
  meMock,
} = vi.hoisted(() => ({
  joinMutate: vi.fn(),
  leaveMutate: vi.fn(),
  membersMock: vi.fn(),
  slotsMock: vi.fn(),
  surveyMock: vi.fn(),
  meMock: vi.fn(),
}));

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: meMock() }),
  useEventMembers: () => ({ data: membersMock() }),
  useEventSlots: () => ({ data: slotsMock() }),
  useJoinEvent: () => ({ mutate: joinMutate, isPending: false }),
  useLeaveEvent: () => ({ mutate: leaveMutate, isPending: false }),
}));
vi.mock("../api/scoringHooks.js", () => ({
  useEventState: () => ({ data: null }),
}));
vi.mock("../api/eventSurveyHooks.js", () => ({
  useEventSurvey: () => ({ data: surveyMock() }),
}));

/** 回答ダイアログは中身ではなく「開いたか・押したら何が続くか」だけ見たい */
vi.mock("./SurveyAnswerDialog.js", () => ({
  SurveyAnswerDialog: ({
    open,
    submitLabel,
    onSubmitted,
  }: {
    open: boolean;
    submitLabel: string;
    onSubmitted?: () => void;
  }) =>
    open ? (
      <div data-testid="survey">
        <span data-testid="survey-label">{submitLabel}</span>
        <button onClick={() => onSubmitted?.()}>回答を送信</button>
      </div>
    ) : null,
}));

const EVENT = {
  id: "e-1",
  title: "テストイベント",
  scheduling: false,
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_003_600_000,
  status: "published",
  attendanceCheck: false,
  registrationDeadline: null,
} as Event;

const SLOT: ParticipationSlot = {
  id: "s-1",
  eventId: "e-1",
  name: "午前の部",
  capacity: 10,
  selectionType: "first_come",
  sortOrder: 1,
  drawAt: null,
  confirmedCount: 0,
  waitlistCount: 0,
  appliedCount: 0,
};

const QUESTION = { id: "q-1", eventId: "e-1", label: "所属", required: true };

function timing(over: Partial<EventTiming> = {}): EventTiming {
  return {
    ended: false,
    registrationClosed: false,
    deadlineRemaining: "",
    refresh: vi.fn(),
    ...over,
  };
}

function draw(opts: { myRole?: null; timing?: EventTiming } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
  const t = opts.timing ?? timing();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventJoinPanel
          eventId="e-1"
          event={EVENT}
          myRole={null}
          contest={false}
          timing={t}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { timing: t, invalidate };
}

/** 参加ボタンを押す */
const clickJoin = () =>
  fireEvent.click(screen.getByRole("button", { name: "参加登録する" }));

/** join の onError に、サーバーが返したコードを流し込む */
function joinFailsWith(code: string) {
  joinMutate.mockImplementation(
    (_vars: unknown, opts: { onError: (e: unknown) => void }) => {
      opts.onError(new ApiError(409, { error: code }));
    },
  );
}

beforeEach(() => {
  joinMutate.mockReset();
  leaveMutate.mockReset();
  meMock.mockReturnValue({ id: "u-1", username: "watashi" });
  membersMock.mockReturnValue([]);
  slotsMock.mockReturnValue([]);
  surveyMock.mockReturnValue([]);
});

describe("事前アンケートの挟み込み (#152)", () => {
  it("質問があるときは、参加ボタンでまず回答ダイアログが開く（まだ参加は送らない）", () => {
    surveyMock.mockReturnValue([QUESTION]);
    draw();

    clickJoin();

    expect(screen.getByTestId("survey")).toBeInTheDocument();
    expect(screen.getByTestId("survey-label")).toHaveTextContent(
      "回答して参加する",
    );
    expect(joinMutate).not.toHaveBeenCalled();
  });

  it("回答を送ると、続けて参加が送られる", () => {
    surveyMock.mockReturnValue([QUESTION]);
    draw();

    clickJoin();
    fireEvent.click(screen.getByText("回答を送信"));

    expect(joinMutate).toHaveBeenCalledTimes(1);
    expect(joinMutate.mock.calls[0][0]).toEqual({ id: "e-1" });
  });

  it("質問が無ければダイアログを挟まず、そのまま参加を送る", () => {
    draw();

    clickJoin();

    expect(screen.queryByTestId("survey")).not.toBeInTheDocument();
    expect(joinMutate).toHaveBeenCalledTimes(1);
  });

  it("参加枠から申し込んでも同じで、回答後はその枠で参加する", () => {
    surveyMock.mockReturnValue([QUESTION]);
    slotsMock.mockReturnValue([SLOT]);
    draw();

    // 枠つきのイベントでは参加は枠のボタンからしか始まらない
    expect(
      screen.queryByRole("button", { name: "参加登録する" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "参加する" }));

    expect(joinMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("回答を送信"));

    expect(joinMutate.mock.calls[0][0]).toEqual({ id: "e-1", slotId: "s-1" });
  });

  it("参加後は同じダイアログを回答の編集として開く（参加は続けて送らない）", () => {
    surveyMock.mockReturnValue([QUESTION]);
    membersMock.mockReturnValue([
      { id: "m-1", userId: "u-1", status: "confirmed", user: { id: "u-1" } },
    ]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <EventJoinPanel
            eventId="e-1"
            event={EVENT}
            myRole="participant"
            contest={false}
            timing={timing()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "アンケート回答を編集" }),
    );

    expect(screen.getByTestId("survey-label")).toHaveTextContent("回答を保存");
  });
});

describe("サーバーに断られたときの立て直し (#269)", () => {
  it("必須アンケート未回答なら、理由ではなく回答ダイアログで受ける", () => {
    joinFailsWith("survey_required");
    const { timing: tm, invalidate } = draw();

    clickJoin();

    expect(screen.getByTestId("survey")).toBeInTheDocument();
    // 質問を取り直してから開く（ページを開いた後に質問が追加された場合）
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["event", "e-1", "survey"],
    });
    // 締切をまたいだわけではないので時計は進めない
    expect(tm.refresh).not.toHaveBeenCalled();
  });

  it("締切をまたいでいたら理由を出し、時計を進めてイベントを取り直す", () => {
    joinFailsWith("registration_closed");
    const { timing: tm, invalidate } = draw();

    clickJoin();

    expect(screen.getByText("募集は締め切りました。")).toBeInTheDocument();
    expect(tm.refresh).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event", "e-1"] });
  });

  it("終了をまたいでいたら、終了の理由を出す", () => {
    joinFailsWith("event_ended");
    const { timing: tm } = draw();

    clickJoin();

    expect(screen.getByText("このイベントは終了しました。")).toBeInTheDocument();
    expect(tm.refresh).toHaveBeenCalledTimes(1);
  });

  it("理由は閉じられる（押しても何も起きない画面にしないための表示なので居座らせない）", () => {
    joinFailsWith("registration_closed");
    draw();

    clickJoin();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByText("募集は締め切りました。")).not.toBeInTheDocument();
  });

  it("回答ダイアログを開いたまま締切をまたいだら、ダイアログを閉じて理由に切り替える", () => {
    surveyMock.mockReturnValue([QUESTION]);
    joinFailsWith("registration_closed");
    draw();

    clickJoin();
    expect(screen.getByTestId("survey")).toBeInTheDocument();
    fireEvent.click(screen.getByText("回答を送信"));

    expect(screen.queryByTestId("survey")).not.toBeInTheDocument();
    expect(screen.getByText("募集は締め切りました。")).toBeInTheDocument();
  });

  it("知らないコードはこの経路で拾わない（共通の扱いに任せる）", () => {
    joinFailsWith("something_else");
    const { timing: tm } = draw();

    clickJoin();

    expect(screen.queryByText("募集は締め切りました。")).not.toBeInTheDocument();
    expect(screen.queryByTestId("survey")).not.toBeInTheDocument();
    expect(tm.refresh).not.toHaveBeenCalled();
  });
});

describe("締切・終了の表示", () => {
  it("終了後は参加ボタンを出さず、終了の表示にする", () => {
    draw({ timing: timing({ ended: true }) });

    expect(
      screen.queryByRole("button", { name: "参加登録する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("このイベントは終了しました")).toBeInTheDocument();
  });

  it("締切後の未参加者には、ログインの有無によらず締切を伝える", () => {
    meMock.mockReturnValue(undefined);
    draw({ timing: timing({ registrationClosed: true }) });

    expect(screen.getByText("募集は締め切りました")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "ログインして参加" }),
    ).not.toBeInTheDocument();
  });
});
