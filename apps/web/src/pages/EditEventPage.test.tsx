import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

/**
 * イベント編集でも、終了日時が開始より前なら入力の時点で警告する (#399)。
 *
 * 編集には「日程調整をやめて日時を直接確定する」保存 (#138) があり、この保存
 * だけはサーバーが「終了 > 開始」を要求する（同時刻も不可）。画面の判定も
 * それに合わせる。通常の編集は共有スキーマの契約（終了 >= 開始）どおり
 * 「前」だけを警告する。
 */

const { updateMutate, refetchEvent } = vi.hoisted(() => ({ updateMutate: vi.fn(), refetchEvent: vi.fn() }));

let eventData: Record<string, unknown>;

vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: eventData, isLoading: false, refetch: refetchEvent }),
  useIsAdmin: () => false,
  useUpdateEvent: () => ({
    mutate: updateMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDuplicateEvent: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../api/communityHooks.js", () => ({
  useMyCommunities: () => ({ data: [] }),
}));
// イベント本体の編集と関係ない部品（それぞれが自前で API を呼ぶ）は外す
vi.mock("../components/EventSlotsEditor.js", () => ({
  EventSlotsEditor: () => null,
}));
vi.mock("../components/SurveyQuestionsEditor.js", () => ({
  SurveyQuestionsEditor: () => null,
}));
vi.mock("../components/AwardsEditor.js", () => ({
  AwardsEditor: () => null,
}));
vi.mock("../components/EventImageEditor.js", () => ({
  EventImageEditor: () => null,
}));
vi.mock("../components/MeetPrizeEditor.js", () => ({
  MeetPrizeEditor: () => null,
}));
vi.mock("../components/DescriptionImageTray.js", () => ({
  DescriptionImageTray: () => null,
}));

const { EditEventPage } = await import("./EditEventPage.js");

/** 2026-09-01T10:00〜12:00（Asia/Tokyo。TZ は vitest.config.ts が固定）の既定イベント */
function makeEventData(over: Record<string, unknown> = {}) {
  return {
    event: {
      id: "e-1",
      status: "draft",
      title: "テストイベント",
      subtitle: "",
      description: "",
      startsAt: new Date("2026-09-01T10:00").getTime(),
      endsAt: new Date("2026-09-01T12:00").getTime(),
      registrationDeadline: null,
      scheduling: false,
      venueType: "offline",
      venueOffline: "",
      venueOnline: "",
      contestMode: false,
      attendanceCheck: false,
      chatEnabled: false,
      chatUrlsAllowed: false,
      chatOpenBeforeMinutes: 30,
      chatCloseAfterMinutes: 120,
      qaEnabled: false,
      qaAnonymity: "choice",
      warikanEnabled: false,
      venueWanted: false,
      communityId: null,
      imageUpdatedAt: null,
      ...over,
    },
    myRole: "staff",
    membersNote: "",
  };
}

function draw() {
  return render(
    <MemoryRouter initialEntries={["/events/e-1/edit"]}>
      <Routes>
        <Route path="/events/:id/edit" element={<EditEventPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "保存" });
const orderWarning = () =>
  screen.queryByText("終了日時は開始日時より後にしてください。");

beforeEach(() => {
  updateMutate.mockReset();
  refetchEvent.mockReset();
  eventData = makeEventData();
});

describe("イベント編集の日時順序の警告 (#399)", () => {
  it("終了を開始より前にすると警告が出て保存ボタンが無効になる", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T09:00" },
    });
    expect(orderWarning()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("終了を開始より後に直すと警告が消えて保存できる", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T13:00" },
    });
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("通常の編集では同時刻（開始＝終了）を警告しない（共有スキーマは以降を許容）", () => {
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("日程調整中は日時欄が無く、警告も誤発火しない", () => {
    eventData = makeEventData({ scheduling: true, startsAt: 0, endsAt: 0 });
    draw();
    expect(screen.queryByLabelText("終了日時")).not.toBeInTheDocument();
    expect(orderWarning()).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("日時を直接確定する保存では、サーバーに合わせて同時刻も警告する", () => {
    eventData = makeEventData({ scheduling: true, startsAt: 0, endsAt: 0 });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "日時を直接設定する" }));
    fireEvent.change(screen.getByLabelText("開始日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("終了日時"), {
      target: { value: "2026-09-01T10:00" },
    });
    expect(orderWarning()).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

it("submits the revision that initialized the form, not a newer background response", () => {
  eventData = makeEventData({ accessRevision: 7 });
  const view = draw();
  eventData = makeEventData({ accessRevision: 8 });
  view.rerender(<MemoryRouter initialEntries={["/events/e-1/edit"]}><Routes><Route path="/events/:id/edit" element={<EditEventPage />} /></Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("終了日時"), { target: { value: "2026-09-01T13:00" } });
  fireEvent.click(saveButton());
  expect(updateMutate.mock.calls[0][0].expectedAccessRevision).toBe(7);
});

it("does not present the retained old dates as current when reopened", () => {
  eventData = makeEventData({ scheduling: true, accessRevision: 9 });
  draw();
  fireEvent.click(screen.getByRole("button", { name: "日時を直接設定する" }));
  expect(screen.getByLabelText("開始日時")).toHaveValue("");
  expect(screen.getByLabelText("終了日時")).toHaveValue("");
});

describe("参加者のみ（暗号化）(#582 W6)", () => {
  const encryptSwitch = () =>
    screen.getByRole("checkbox", { name: "参加者のみ（暗号化）" });
  afterEach(() => vi.restoreAllMocks());

  it("オンへの切り替えで確認し、承諾したら chatEncrypted: true を送る", () => {
    eventData = makeEventData({ chatEnabled: true, chatEncrypted: false, visibility: "public" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();
    expect(encryptSwitch()).not.toBeChecked();
    fireEvent.click(encryptSwitch());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("一度オンにすると戻せません"));
    expect(encryptSwitch()).toBeChecked();
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ chatEnabled: true, chatEncrypted: true });
  });

  it("確認で取り消したらオンにならず、chatEncrypted は送らない", () => {
    eventData = makeEventData({ chatEnabled: true, chatEncrypted: false, visibility: "public" });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    draw();
    fireEvent.click(encryptSwitch());
    expect(encryptSwitch()).not.toBeChecked();
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).not.toHaveProperty("chatEncrypted");
  });

  it("オン済みならスイッチは無効（戻せない）", () => {
    eventData = makeEventData({ chatEnabled: true, chatEncrypted: true, visibility: "public" });
    draw();
    expect(encryptSwitch()).toBeChecked();
    expect(encryptSwitch()).toBeDisabled();
    expect(screen.getByText("この設定は戻せません。")).toBeInTheDocument();
  });

  it("非公開ではチャットのオンと連動する（確認のうえ、暗号化も同時にオン）", () => {
    eventData = makeEventData({ chatEnabled: false, chatEncrypted: false, visibility: "private" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();
    fireEvent.click(screen.getByRole("checkbox", { name: "参加者チャット" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(encryptSwitch()).toBeChecked();
    expect(encryptSwitch()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ chatEnabled: true, chatEncrypted: true });
  });

  it("非公開でチャットのオンを取り消したらチャットもオフのまま", () => {
    eventData = makeEventData({ chatEnabled: false, chatEncrypted: false, visibility: "private" });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    draw();
    fireEvent.click(screen.getByRole("checkbox", { name: "参加者チャット" }));
    expect(screen.queryByRole("checkbox", { name: "参加者のみ（暗号化）" })).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ chatEnabled: false });
    expect(updateMutate.mock.calls[0][0]).not.toHaveProperty("chatEncrypted");
  });
});

describe("参加者チャットの書き込める期間 (#578)", () => {
  const combo = (name: string) => screen.getByRole("combobox", { name });
  const choose = (field: string, option: string) => {
    fireEvent.mouseDown(combo(field));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };
  const sent = () => updateMutate.mock.calls[0][0] as Record<string, unknown>;

  it("チャットがオフのときは出さない", () => {
    draw();
    expect(screen.queryByText("書き込める期間")).not.toBeInTheDocument();
  });

  it("既定（開始30分前から・終了2時間後まで）を出し、そのまま保存すると既定値を送る", () => {
    eventData = makeEventData({ chatEnabled: true, visibility: "public" });
    draw();
    expect(screen.getByText("書き込める期間")).toBeInTheDocument();
    expect(combo("いつから")).toHaveTextContent("開始30分前から");
    expect(combo("いつまで")).toHaveTextContent("終了2時間後まで");
    expect(screen.queryByRole("combobox", { name: "何日前" })).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ chatOpenBeforeMinutes: 30, chatCloseAfterMinutes: 120 });
  });

  it("参加が確定したらすぐ・終了7日後までを選ぶと null と 10080 を送る", () => {
    eventData = makeEventData({ chatEnabled: true, visibility: "public" });
    draw();
    choose("いつから", "参加が確定したらすぐ");
    choose("いつまで", "終了7日後まで");
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ chatOpenBeforeMinutes: null, chatCloseAfterMinutes: 10080 });
  });

  it("開始の N 日前からを選ぶと日数を選べ、分にして送る", () => {
    eventData = makeEventData({ chatEnabled: true, visibility: "public" });
    draw();
    choose("いつから", "開始の N 日前から");
    expect(combo("何日前")).toHaveTextContent("1日前");
    choose("何日前", "3日前");
    choose("いつまで", "終了1日後まで");
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ chatOpenBeforeMinutes: 3 * 1440, chatCloseAfterMinutes: 1440 });
  });

  it("保存済みの N 日前・参加確定したらすぐを読み込んで表示する", () => {
    eventData = makeEventData({ chatEnabled: true, visibility: "public", chatOpenBeforeMinutes: 14 * 1440, chatCloseAfterMinutes: 1440 });
    const view = draw();
    expect(combo("いつから")).toHaveTextContent("開始の N 日前から");
    expect(combo("何日前")).toHaveTextContent("14日前");
    expect(combo("いつまで")).toHaveTextContent("終了1日後まで");
    view.unmount();
    eventData = makeEventData({ chatEnabled: true, visibility: "public", chatOpenBeforeMinutes: null });
    draw();
    expect(combo("いつから")).toHaveTextContent("参加が確定したらすぐ");
  });
});

describe("割り勘のオン/オフ (#635)", () => {
  const warikanSwitch = () => screen.getByLabelText("割り勘");

  it("既定はオフで、オンにして保存すると warikanEnabled: true を送る", () => {
    draw();
    expect(warikanSwitch()).not.toBeChecked();
    fireEvent.click(warikanSwitch());
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: true });
  });

  // オフへの切り替えは、立替の件数を問い合わせてから保存する (#636) ので待って確かめる
  it("保存済みのオンを読み込み、オフにして保存すると warikanEnabled: false を送る", async () => {
    eventData = makeEventData({ warikanEnabled: true });
    draw();
    expect(warikanSwitch()).toBeChecked();
    fireEvent.click(warikanSwitch());
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: false }),
    );
  });
});

/**
 * 立替が残ったままオフにすると参加者から帳簿が見えなくなる (#636)。
 * 件数の問い合わせ（GET /events/:id/warikan/expense-count）だけを差し替える。
 */
describe("割り勘をオフにする前の確認 (#636)", () => {
  const warikanSwitch = () => screen.getByLabelText("割り勘");
  const stubExpenseCount = (count: number, ok = true) => {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(ok ? { expenses: count } : { error: "boom" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const offEvent = () => {
    eventData = makeEventData({ warikanEnabled: true });
    draw();
    fireEvent.click(warikanSwitch());
    fireEvent.click(saveButton());
  };

  it("立替があるときにオフへ変えると、件数を出して確認する", async () => {
    stubExpenseCount(3);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    offEvent();
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toContain("立替が3件あります");
    // 問い合わせは保存の直前にだけ走る（開いた時点では呼ばない）
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/events/e-1/warikan/expense-count");
  });

  it("確認でキャンセルすると保存しない", async () => {
    stubExpenseCount(3);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    offEvent();
    // 確認まで進んだことを待ってから、保存されていないことを見る
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("確認で OK すると warikanEnabled: false を送る", async () => {
    stubExpenseCount(2);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    offEvent();
    await waitFor(() =>
      expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: false }),
    );
  });

  it("立替が0件なら確認せずに保存する", async () => {
    stubExpenseCount(0);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    offEvent();
    await waitFor(() =>
      expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: false }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("件数を取れないときは確認せずに保存する", async () => {
    stubExpenseCount(0, false);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    offEvent();
    await waitFor(() =>
      expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: false }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("読み込んだときオフなら、オンにして保存しても確認しない", async () => {
    const fetchMock = stubExpenseCount(4);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    draw();
    fireEvent.click(warikanSwitch());
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(updateMutate.mock.calls[0][0]).toMatchObject({ warikanEnabled: true }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("イベント編集の会場の住所", () => {
  const addressField = () => screen.queryByLabelText(/^住所/);

  it("保存済みの住所を出し、消して保存すると venueAddress: null を送る", () => {
    eventData = makeEventData({ venueOffline: "丸の内ホール", venueAddress: "東京都千代田区丸の内1-9-1" });
    draw();
    expect(addressField()).toHaveValue("東京都千代田区丸の内1-9-1");
    fireEvent.change(addressField()!, { target: { value: "" } });
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[0][0]).toMatchObject({ venueOffline: "丸の内ホール", venueAddress: null });
  });

  it("ハイブリッドでは住所欄を出し、オンラインでは出さない", () => {
    eventData = makeEventData({ venueType: "hybrid" });
    const { unmount } = draw();
    expect(addressField()).toBeInTheDocument();
    unmount();
    eventData = makeEventData({ venueType: "online" });
    draw();
    expect(addressField()).not.toBeInTheDocument();
  });
});

describe("予約公開 (D-EVENT-SCHEDULED-PUBLISH)", () => {
  const sent = () => updateMutate.mock.calls[0][0] as Record<string, unknown>;
  const future = () => {
    const d = new Date(Date.now() + 2 * 86400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  };

  const dateField = () => screen.getByLabelText("公開する日");
  const timeField = () => screen.getByLabelText("公開する時刻");

  it("「予約公開」を選ぶと日付と30分刻みの時刻の欄が出て、下書きのまま publishAt と revision を送る", () => {
    eventData = makeEventData({ accessRevision: 4, publishAt: null });
    draw();
    expect(screen.queryByLabelText("公開する日")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "予約公開" }));
    // 最初は次の0分か30分が入っている
    expect(timeField()).toHaveValue(new Date(Math.floor(Date.now() / 1800_000) * 1800_000 + 1800_000).toTimeString().slice(0, 5));
    const options = Array.from(timeField().querySelectorAll("option")).map((o) => o.value);
    expect(options).toHaveLength(48);
    expect(options.every((v) => /:(00|30)$/.test(v))).toBe(true);
    const value = future();
    fireEvent.change(dateField(), { target: { value: value.slice(0, 10) } });
    fireEvent.change(timeField(), { target: { value: "10:30" } });
    expect(screen.getByText(/30分単位（毎時0分・30分）/)).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({
      status: "draft",
      publishAt: new Date(`${value.slice(0, 10)}T10:30`).getTime(),
      expectedAccessRevision: 4,
    });
  });

  it("過去の日時では保存できない", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "予約公開" }));
    fireEvent.change(dateField(), { target: { value: "2020-01-01" } });
    expect(screen.getByText("未来の日時を入れてください。")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("予約済みを読み込んで表示し、下書きに戻すと publishAt: null を送る", () => {
    const at = new Date(future()).getTime();
    eventData = makeEventData({ accessRevision: 5, publishAt: at });
    draw();
    expect(screen.getByRole("button", { name: "予約公開" })).toHaveAttribute("aria-pressed", "true");
    expect(dateField()).toHaveValue(future().slice(0, 10));
    expect(timeField()).toHaveValue("10:00");
    fireEvent.click(screen.getByRole("button", { name: "非公開（下書き）" }));
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ status: "draft", publishAt: null, expectedAccessRevision: 5 });
  });

  it("公開を選ぶと publishAt は送らない（サーバーが予約を消す）", () => {
    eventData = makeEventData({ visibility: "public", publishAt: new Date(future()).getTime() });
    draw();
    fireEvent.click(screen.getByRole("button", { name: "公開" }));
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ status: "published" });
    expect(sent()).not.toHaveProperty("publishAt");
  });
});

describe("日時を変えない保存は revision を照合しない（参加登録で 409 にしない）", () => {
  const sent = () => updateMutate.mock.calls[0][0] as Record<string, unknown>;
  const titleField = () => screen.getByLabelText(/^タイトル/);

  it("題名だけ直した保存は、日時・締切・revision を送らない", () => {
    eventData = makeEventData({ accessRevision: 3, registrationDeadline: new Date("2026-08-31T10:00").getTime() });
    draw();
    fireEvent.change(titleField(), { target: { value: "新しい題名" } });
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ title: "新しい題名" });
    for (const key of ["startsAt", "endsAt", "registrationDeadline", "scheduling", "expectedAccessRevision"]) {
      expect(sent()).not.toHaveProperty(key);
    }
  });

  it("日時を変えた保存は、日時と読み込んだ revision を送る", () => {
    eventData = makeEventData({ accessRevision: 3 });
    draw();
    fireEvent.change(screen.getByLabelText("終了日時"), { target: { value: "2026-09-01T13:00" } });
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({
      startsAt: new Date("2026-09-01T10:00").getTime(),
      endsAt: new Date("2026-09-01T13:00").getTime(),
      expectedAccessRevision: 3,
    });
    expect(sent()).not.toHaveProperty("registrationDeadline");
  });

  it("締切だけ変えた保存は、締切と revision を送り、日時は送らない", () => {
    eventData = makeEventData({ accessRevision: 3 });
    draw();
    fireEvent.change(screen.getByLabelText(/^募集締切/), { target: { value: "2026-08-31T18:00" } });
    fireEvent.click(saveButton());
    expect(sent()).toMatchObject({ registrationDeadline: new Date("2026-08-31T18:00").getTime(), expectedAccessRevision: 3 });
    expect(sent()).not.toHaveProperty("startsAt");
  });

  it("409 schedule_changed では題名の入力を残し、日時と revision だけ最新に入れ直す（自動で再送しない）", async () => {
    eventData = makeEventData({ accessRevision: 3 });
    draw();
    fireEvent.change(titleField(), { target: { value: "直した題名" } });
    fireEvent.change(screen.getByLabelText("終了日時"), { target: { value: "2026-09-01T13:00" } });
    const latest = makeEventData({
      accessRevision: 6,
      startsAt: new Date("2026-09-02T10:00").getTime(),
      endsAt: new Date("2026-09-02T12:00").getTime(),
    });
    refetchEvent.mockImplementation(async () => {
      eventData = latest;
      return { data: latest };
    });
    const { ApiError } = await import("../api/client.js");
    updateMutate.mockImplementationOnce((_input, options) => {
      options.onError(new ApiError(409, { error: "schedule_changed" }));
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(screen.getByLabelText("開始日時")).toHaveValue("2026-09-02T10:00"));
    expect(screen.getByLabelText("終了日時")).toHaveValue("2026-09-02T12:00");
    expect(titleField()).toHaveValue("直した題名");
    expect(updateMutate).toHaveBeenCalledTimes(1);

    // 最新の日時を見たうえで題名だけ保存し直すと、日時も revision も送らない
    fireEvent.click(saveButton());
    const retry = updateMutate.mock.calls[1][0] as Record<string, unknown>;
    expect(retry).toMatchObject({ title: "直した題名" });
    expect(retry).not.toHaveProperty("startsAt");
    expect(retry).not.toHaveProperty("expectedAccessRevision");

    // 日時を変えて保存し直すと、新しい revision で照合する
    fireEvent.change(screen.getByLabelText("終了日時"), { target: { value: "2026-09-02T13:00" } });
    fireEvent.click(saveButton());
    expect(updateMutate.mock.calls[2][0]).toMatchObject({ expectedAccessRevision: 6, title: "直した題名" });
  });
});
