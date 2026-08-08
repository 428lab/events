import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CARDS_PER_SHEET,
  NAME_CARD_GAP_MM,
  NAME_CARD_H_MM,
  NAME_CARD_W_MM,
  SHEET_COLS,
  SHEET_MARGIN_X_MM,
  SHEET_MARGIN_Y_MM,
  SHEET_ROWS,
  SHEET_W_MM,
} from "@eventer/shared";
import type { EventNameCard, EventRole } from "@eventer/shared";

/**
 * 名札の一括印刷 (#304)。
 *
 * オフラインイベントの名札を主催者がまとめて刷るための画面。
 * 「既定で全員が選ばれている」「外した人は刷られない」「スタッフ以外は使えない」
 * の3つが崩れると当日の受付が回らなくなるので、ここで固定しておく。
 * 見た目は既存のプロフィールカード (#178) をそのまま使う（新しい意匠は作らない）。
 */

const { getMock, cardRenders } = vi.hoisted(() => ({
  getMock: vi.fn(),
  cardRenders: vi.fn(),
}));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

// カードSVGは本物のまま使い、何回描かれたかだけ数える（描き直しの退行検知用）
vi.mock("../components/licenseCard/LicenseCardSvg.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../components/licenseCard/LicenseCardSvg.js")
    >();
  const Real = actual.LicenseCardSvg;
  return {
    ...actual,
    LicenseCardSvg: (props: Parameters<typeof Real>[0]) => {
      cardRenders(props.card.handle);
      return <Real {...props} />;
    },
  };
});

const { NameCardPrintPage, toSheets, PRINT_STYLES, HIDDEN_IN_PRINT } =
  await import("./NameCardPrintPage.js");
const { VersionFooter } = await import("../components/VersionFooter.js");

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

function card(over: Partial<EventNameCard> = {}): EventNameCard {
  const id = over.id ?? "u-1";
  return {
    id,
    role: "participant",
    handle: `handle-${id}`,
    name: `参加者 ${id}`,
    avatarUrl: null,
    cardImageKey: null,
    createdAt: 1_700_000_000_000,
    participation: { attended: 0, noShow: 0, hosted: 0, spoken: 0 },
    gamification: {
      xp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      badges: [],
    },
    communities: [],
    ...over,
  };
}

/** イベント詳細（myRole）と名札一覧の2本を出し分ける */
function mockApi(myRole: EventRole | null, cards: EventNameCard[]): void {
  getMock.mockImplementation((path: string) => {
    if (path === `/events/${EVENT_ID}/name-cards`) {
      // 権限のない相手にはサーバーが 403 を返すので、ここでは呼ばれないこと自体が期待値
      return Promise.resolve({ cards });
    }
    if (path === `/events/${EVENT_ID}`) {
      return Promise.resolve({
        event: { id: EVENT_ID, title: "オフライン回" },
        myRole,
        community: null,
      });
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/events/${EVENT_ID}/name-cards`]}>
        <Routes>
          <Route
            path="/events/:id/name-cards"
            element={<NameCardPrintPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 用紙に載っているカード（＝実際に刷られるもの） */
function printedNames(): string[] {
  return screen
    .queryAllByRole("img", { name: /のプロフィールカード$/ })
    .map((el) => el.getAttribute("aria-label")!.replace(/ のプロフィールカード$/, ""));
}

beforeEach(() => {
  getMock.mockReset();
  cardRenders.mockClear();
  localStorage.clear();
});

describe("名札の印刷: 誰を刷るか (#304)", () => {
  it("参加確定メンバー全員が最初から選ばれている", async () => {
    const cards = [
      card({ id: "u-1", name: "田中" }),
      card({ id: "u-2", name: "鈴木", role: "staff" }),
      card({ id: "u-3", name: "佐藤", role: "observer" }),
    ];
    mockApi("staff", cards);
    renderPage();

    await waitFor(() =>
      expect(printedNames().sort()).toEqual(["佐藤", "田中", "鈴木"]),
    );
    // スタッフ・観覧者も既定で対象（当日に名札が要るのは参加者だけではない）
    for (const name of ["田中", "鈴木", "佐藤"]) {
      expect(
        screen.getByRole("checkbox", { name: `${name} を印刷する` }),
      ).toBeChecked();
    }
    expect(screen.getByText("3 人 / 3 人（A4 1 枚）")).toBeInTheDocument();
  });

  it("チェックを外した人は用紙から消える（当日追加の人だけ刷り直せる）", async () => {
    mockApi("staff", [
      card({ id: "u-1", name: "田中" }),
      card({ id: "u-2", name: "鈴木" }),
    ]);
    renderPage();
    await waitFor(() => expect(printedNames()).toHaveLength(2));

    fireEvent.click(screen.getByRole("checkbox", { name: "田中 を印刷する" }));

    await waitFor(() => expect(printedNames()).toEqual(["鈴木"]));
    expect(screen.getByText("1 人 / 2 人（A4 1 枚）")).toBeInTheDocument();
    // 名簿の行は残る（あとで戻せる）
    expect(
      screen.getByRole("checkbox", { name: "田中 を印刷する" }),
    ).not.toBeChecked();
  });

  it("すべて外すと印刷ボタンが押せない", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中" })]);
    renderPage();
    await waitFor(() => expect(printedNames()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "すべて外す" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /印刷する/ })).toBeDisabled(),
    );
    expect(printedNames()).toEqual([]);
  });
});

describe("名札の印刷: 権限 (#304)", () => {
  it("参加者は使えない（名簿も取りに行かない）", async () => {
    mockApi("participant", [card()]);
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("この画面はイベントのスタッフだけが使えます。"),
      ).toBeInTheDocument(),
    );
    expect(printedNames()).toEqual([]);
    expect(getMock).not.toHaveBeenCalledWith(
      `/events/${EVENT_ID}/name-cards`,
    );
  });

  it("メンバーでない人（未ログイン・サイト管理者を含む）も使えない", async () => {
    mockApi(null, [card()]);
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("この画面はイベントのスタッフだけが使えます。"),
      ).toBeInTheDocument(),
    );
    expect(getMock).not.toHaveBeenCalledWith(
      `/events/${EVENT_ID}/name-cards`,
    );
  });
});

describe("名札の印刷: 本人が設定したカードで刷る (#304)", () => {
  it("本人が選んだ見た目で描く（刷る人の設定では上書きしない）", async () => {
    mockApi("staff", [
      card({ id: "u-1", name: "田中", cardImageKey: "arcs-teal" }),
      card({ id: "u-2", name: "鈴木", cardImageKey: "flow-amber" }),
    ]);
    renderPage();
    await screen.findByText(/2 人/);
    const svgs = document.querySelectorAll(".name-card-cell svg");
    expect(svgs).toHaveLength(2);
    // 背景の描き分けが実際に違うこと（同じ見た目で刷られていない）
    expect(svgs[0]!.innerHTML).not.toBe(svgs[1]!.innerHTML);
  });

  it("カードを保存していない人は既定の見た目で描く（欠けても壊れない）", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中", cardImageKey: null })]);
    renderPage();
    await screen.findByText(/1 人/);
    expect(document.querySelectorAll(".name-card-cell svg")).toHaveLength(1);
  });

  it("アイコンが読み込めないときは名前の1文字目に戻す", async () => {
    mockApi("staff", [
      card({ id: "u-1", name: "田中", avatarUrl: "https://example.com/x.png" }),
    ]);
    renderPage();
    await screen.findByText(/1 人/);
    const img = document.querySelector('[data-avatar="1"]');
    expect(img).toBeTruthy();
    // 読み込み失敗を通知すると画像が消え、下に描いてあるイニシャルが見える
    fireEvent.error(img!);
    await waitFor(() =>
      expect(document.querySelector('[data-avatar="1"]')).toBeNull(),
    );
    expect(screen.getAllByText("田").length).toBeGreaterThan(0);
  });
});

describe("名札の印刷: 面付けと崩れにくさ (#304)", () => {
  it("A4に10面（2列×5行）。カードの間を1mmあけ、余白は左右13.5mm・上下9mm", () => {
    expect(CARDS_PER_SHEET).toBe(10);
    expect(SHEET_COLS * NAME_CARD_W_MM).toBe(182);
    expect(SHEET_ROWS * NAME_CARD_H_MM).toBe(275);
    // 完全にくっついていると裁断しづらいので間をあける
    expect(NAME_CARD_GAP_MM).toBeGreaterThan(0);
    expect(SHEET_MARGIN_X_MM).toBe(13.5);
    expect(SHEET_MARGIN_Y_MM).toBe(9);
    // 用紙からはみ出さない。上下の余白はプリンタが刷れる範囲（5mm以上）に収める
    const usedW =
      SHEET_COLS * NAME_CARD_W_MM + (SHEET_COLS - 1) * NAME_CARD_GAP_MM;
    const usedH =
      SHEET_ROWS * NAME_CARD_H_MM + (SHEET_ROWS - 1) * NAME_CARD_GAP_MM;
    expect(usedW + SHEET_MARGIN_X_MM * 2).toBe(210);
    expect(usedH + SHEET_MARGIN_Y_MM * 2).toBe(297);
    expect(SHEET_MARGIN_Y_MM).toBeGreaterThanOrEqual(5);
  });

  it("11人以上は用紙をまたいで割り付けられる", () => {
    const ids = Array.from({ length: 23 }, (_, i) => i);
    const sheets = toSheets(ids);
    expect(sheets.map((s) => s.length)).toEqual([10, 10, 3]);
    // 順番は崩さない（名簿の並びのまま刷れる）
    expect(sheets.flat()).toEqual(ids);
  });

  it("用紙はA4の実寸で組む（ブラウザの印刷にそのまま渡せる）", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中" })]);
    const { container } = renderPage();
    await waitFor(() => expect(printedNames()).toHaveLength(1));

    const sheet = container.querySelector<HTMLElement>(".name-card-sheet");
    expect(sheet?.style.width).toBe(`${SHEET_W_MM}mm`);
    const cell = container.querySelector<HTMLElement>(".name-card-cell");
    expect(cell?.style.width).toBe(`${NAME_CARD_W_MM}mm`);
    expect(cell?.style.height).toBe(`${NAME_CARD_H_MM}mm`);
    // 操作UIは印刷側で display:none にする対象。目印のクラスが外れると
    // 隠したはずのものが高さを持ったまま残り、1枚目の面付けがずれる
    expect(container.querySelector(".name-card-controls")).toBeTruthy();
    expect(container.querySelector("#name-card-sheets")).toBeTruthy();
  });

  it("アイコン未設定でもイニシャルで刷れる（画像の穴が空かない）", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中", avatarUrl: null })]);
    const { container } = renderPage();
    await waitFor(() => expect(printedNames()).toEqual(["田中"]));

    const svg = container.querySelector(".name-card-cell svg")!;
    expect(svg.querySelector("image[data-avatar]")).toBeNull();
    // アバター枠にはイニシャルが入る
    expect(
      Array.from(svg.querySelectorAll("text")).map((t) => t.textContent),
    ).toContain("田");
  });

  it("カードは描き足しても既に描いた分を描き直さない", async () => {
    // 13人＝6枚ずつ3回に分けて描き足す。memo が外れると 6+12+13=31 回になる
    const cards = Array.from({ length: 13 }, (_, i) =>
      card({ id: `u-${i}`, name: `参加者${i}` }),
    );
    mockApi("staff", cards);
    renderPage();

    await waitFor(() => expect(printedNames()).toHaveLength(13));
    expect(cardRenders).toHaveBeenCalledTimes(13);
  });

  it("長い表示名でもカード幅に収まるまで字を縮める", async () => {
    const LONG = "とてもとても長い表示名のかたです".repeat(4);
    mockApi("staff", [card({ id: "u-1", name: LONG })]);
    const { container } = renderPage();
    await waitFor(() => expect(printedNames()).toEqual([LONG]));

    const svg = container.querySelector(".name-card-cell svg")!;
    const nameText = Array.from(svg.querySelectorAll("text")).find(
      (t) => t.textContent === LONG,
    );
    expect(nameText).toBeTruthy();
    const size = Number(nameText!.getAttribute("font-size"));
    // 下限16pxまで縮み、既定の72pxのままにはならない
    expect(size).toBeGreaterThanOrEqual(16);
    expect(size).toBeLessThan(72);
  });
});

/**
 * 余分な白紙は「印刷してみないと気づかない」種類の壊れ方で、印刷用スタイルを
 * 整理したときに戻りやすい。実測で1シート＝1枚になった条件をここで固定しておく。
 */
describe("名札の印刷: 余分なページを出さない (#304)", () => {
  const printRules = PRINT_STYLES["@media print"] as unknown as Record<
    string,
    Record<string, string>
  >;

  it("用紙を並べる箱は印刷では overflow を外す（外さないと末尾に白紙が1枚増える）", () => {
    // overflow が visible 以外だと分割できないボックスになり、中身が1枚に収まっていても
    // Chrome は次のページを作る。画面の横スクロールのために付けているので print で解除する
    expect(printRules["#name-card-sheets"].overflow).toBe("visible !important");
  });

  it("画面では横スクロールできるままにする（印刷のためにプレビューを壊さない）", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中" })]);
    const { container } = renderPage();
    await waitFor(() => expect(printedNames()).toHaveLength(1));

    const sheets = container.querySelector<HTMLElement>("#name-card-sheets")!;
    expect(getComputedStyle(sheets).overflowX).toBe("auto");
  });

  it("共通フッターも印刷では消す（最後の用紙のあとに1枚流れる）", () => {
    expect(HIDDEN_IN_PRINT).toContain(".version-footer");
    expect(printRules[HIDDEN_IN_PRINT.join(",")].display).toBe(
      "none !important",
    );
  });

  it("印刷で消す目印が共通フッター側から外れていない", () => {
    vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
    const { container } = render(
      <MemoryRouter>
        <VersionFooter />
      </MemoryRouter>,
    );
    // Layout では Container の外にいるので、この目印が外れると刷られてしまう
    expect(
      HIDDEN_IN_PRINT.some((sel) => container.querySelector(sel)),
    ).toBe(true);
    vi.unstubAllGlobals();
  });

  it("印刷用スタイルが実際に文書へ入る（GlobalStyles が外れたら落ちる）", async () => {
    mockApi("staff", [card({ id: "u-1", name: "田中" })]);
    renderPage();
    await waitFor(() => expect(printedNames()).toHaveLength(1));

    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("")
      .replace(/\s+/g, "");
    expect(css).toContain("@mediaprint");
    expect(css).toContain("overflow:visible!important");
    expect(css).toContain(".version-footer");
  });
});
