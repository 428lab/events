import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { ChatMembersPayload, Event } from "@eventer/shared";
import { ApiError } from "../api/client.js";
import { EventChat } from "./EventChat.js";

/**
 * 投影用画面 (#215) の退行防止。`variant="display"` は会場のスクリーンに
 * 映る「見せるだけ」の画面なので、
 * - 参加UI（鍵の選び方・「チャットに参加する」）
 * - 入力欄
 * - スタッフ用の操作UI（メッセージの非表示・チャンネルの作り直し）
 * が出てはいけない。同時に、**参加していなくてもメッセージは読める**
 * （NIP-07 で参加している人が開くと signer が決まらず、以前は参加フォームだけが
 * 投影され続けた）ことを確かめる。
 *
 * 比較用に variant="page"（通常のチャット画面）でスタッフ操作が出ることも見て、
 * 「そもそも出ない状態」を通過してしまわないようにしている。
 */

const ME = { id: "u-1", username: "me", name: "わたし" };

/** チャンネルの購読で受け取ったコールバック（テストから配信するため保持する） */
let deliver: ((ev: NostrEvent) => void) | null = null;

/**
 * GET /chat-key/ephemeral の結果。既定は null＝**NIP-07 で参加している人**の状態
 * （サーバーは一時鍵を持っていないので 404 になる）。この人が投影用画面を開くと
 * 自動再参加が成立せず signer が決まらない、というのが直した不具合そのもの。
 */
let ephemeralKey: { secret: string } | null = null;

const CHAT: ChatMembersPayload = {
  members: [
    {
      pubkey: "pk-me",
      userId: "u-1",
      username: "me",
      name: "わたし",
      avatarUrl: null,
      role: "staff",
    },
  ],
  channelId: "chan-1",
  chatEnabled: true,
  hiddenNoteIds: [],
  relays: ["wss://relay.example"],
};

const MESSAGE = {
  id: "note-1",
  pubkey: "pk-me",
  created_at: 1_700_000_000,
  kind: 42,
  tags: [],
  content: "会場からの発言",
  sig: "",
} as unknown as NostrEvent;

const EVENT = {
  id: "e-1",
  title: "テストイベント",
  status: "published",
  chatEnabled: true,
  chatUrlsAllowed: false,
  scheduling: false,
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_003_600_000,
  createdBy: "u-9",
} as unknown as Event;

vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: ME }),
}));

vi.mock("../lib/nostr.js", () => ({
  // 拡張がある環境（参加UIの選択肢がいちばん増える状態）で確かめる
  hasNip07: () => true,
}));

/** useChatMembers の返り値。締め出し (#283) の確認では error を差し替える。
 * react-query は失敗しても直前の data を保持するので、**data と error が
 * 同時にある**（発言中に締め出された）状態が実際に起きる形 */
let chatQuery: { data?: ChatMembersPayload; error?: unknown } = { data: CHAT };

/** 「チャットに参加する」を押したときの一時鍵の発行 (#223) の結果。
 * 参加時に締め出しが分かる経路 (#283) を確かめるため差し替えられるようにしてある */
let joinResult: () => Promise<{ secret: string; pubkey: string }> = async () => ({
  secret: "00",
  pubkey: "pk-me",
});

vi.mock("../api/eventChatHooks.js", () => ({
  useChatMembers: () => chatQuery,
  useRegisterChatKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreateEphemeralChatKey: () => ({
    isPending: false,
    mutateAsync: () => joinResult(),
  }),
  useRegisterChatChannel: () => ({ mutateAsync: vi.fn() }),
  useResetChatChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useHideChatNote: () => ({ isPending: false, mutate: vi.fn() }),
  // 自動再参加 (#223) の一時鍵。投影用画面ではこれに頼らない
  fetchEphemeralChatKey: vi.fn(async () => ephemeralKey),
  useCreateChatChannel: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("../lib/nostrChat.js", () => {
  const signer = { pubkey: "pk-me", signEvent: vi.fn() };
  return {
    ChatRelayPool: class {
      onstatus: (() => void) | null = null;
      connected = true;
      async connect() {}
      subscribe(_channelId: string, onEvent: (ev: NostrEvent) => void) {
        deliver = onEvent;
        return () => {
          deliver = null;
        };
      }
      async publish() {
        return true;
      }
      close() {}
    },
    buildChannelCreateTemplate: vi.fn(),
    buildChatKeyProofTemplate: vi.fn(),
    buildChannelMessageTemplate: vi.fn(),
    localSignerFromHex: () => signer,
    nip07Signer: async () => signer,
    randomLocalSigner: () => ({ pubkey: "pk-readonly", signEvent: vi.fn() }),
  };
});

beforeEach(() => {
  deliver = null;
  ephemeralKey = null;
  chatQuery = { data: CHAT };
  joinResult = async () => ({ secret: "00", pubkey: "pk-me" });
  localStorage.clear();
});

/** 描画して、非同期の自動再参加・リレー接続が落ち着くまで待つ */
async function renderChat(variant: "display" | "page") {
  const view = render(
    <MemoryRouter>
      <EventChat
        eventId="e-1"
        event={EVENT}
        myRole="staff"
        canChat
        variant={variant}
      />
    </MemoryRouter>,
  );
  // マイクロタスク（鍵の取得→接続→購読）を一巡させる
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/** 描画したうえで、メッセージを1件リレーから受け取った状態にする */
async function drawChat(variant: "display" | "page") {
  const view = await renderChat(variant);
  await waitFor(() => expect(deliver).not.toBeNull());
  await act(async () => {
    deliver!(MESSAGE);
  });
  return view;
}

describe('EventChat variant="display"（投影用画面）', () => {
  it("一時鍵が取れない（NIP-07 で参加している）人が開いてもメッセージが読める", async () => {
    await drawChat("display");

    // ここが出ないと「参加フォームだけが投影され続ける」状態になる
    expect(await screen.findByText("会場からの発言")).toBeInTheDocument();
  });

  it("参加UIを出さない", async () => {
    // メッセージが流れてこない状態でも参加UIに切り替わらないこと
    await renderChat("display");

    expect(
      screen.queryByRole("button", { name: "チャットに参加する" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("イベント用の一時鍵で発言"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nostrアカウントで発言")).not.toBeInTheDocument();
    // 入力欄も出さない（読むだけの画面）
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("スタッフ操作（メッセージの非表示・チャンネルの作り直し）を出さない", async () => {
    await drawChat("display");
    await screen.findByText("会場からの発言");

    expect(
      screen.queryAllByTestId("VisibilityOffOutlinedIcon"),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "チャンネルを作り直す" }),
    ).not.toBeInTheDocument();
  });
});

describe('EventChat variant="page"（通常のチャット画面）', () => {
  it("スタッフには非表示ボタンと入力欄が出る（display 側の確認が空振りでないこと）", async () => {
    // 一時鍵で参加している人＝自動再参加が成立する状態
    ephemeralKey = { secret: "00" };
    await drawChat("page");
    expect(await screen.findByText("会場からの発言")).toBeInTheDocument();

    expect(
      screen.queryAllByTestId("VisibilityOffOutlinedIcon").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

/**
 * 締め出された発言者に見せる画面 (#283)。
 *
 * 理由は書かない（伝えると別の鍵を作って戻ってくるだけで意味がない）。
 * ただし「ネットワークが不調です」のような嘘も書かない。事実として正しい
 * 「接続できません」だけを出す。
 *
 * すでに発言していた人がその場で締め出される形なので、直前の許可リスト（data）を
 * 抱えたまま 403 になる状態で確かめる。
 */
/**
 * 署名の手段を変えても過去の自分の発言が見えること (#332)。
 *
 * 拡張機能が使えない端末で入り直すと発言鍵が変わる。許可リストには
 * 「その人がこれまでに使った鍵」が全部載るので、前の鍵で書いた発言も描画される。
 * 逆に、許可リストに無い鍵の発言は誰のものとしても描かない。
 */
describe("署名の手段が変わっても過去の自分の発言が見える (#332)", () => {
  /** 前の端末で使っていた鍵 pk-old と、いまの端末の鍵 pk-me の2行が載った許可リスト。
   * 他人 (u-2) の鍵も1つ混ぜてある */
  const CHAT_WITH_OLD_KEY: ChatMembersPayload = {
    ...CHAT,
    members: [
      {
        pubkey: "pk-old",
        userId: "u-1",
        username: "me",
        name: "わたし",
        avatarUrl: null,
        role: "staff",
      },
      ...CHAT.members,
      {
        pubkey: "pk-other",
        userId: "u-2",
        username: "other",
        name: "だれか",
        avatarUrl: null,
        role: "participant",
      },
    ],
  };

  const message = (id: string, pubkey: string, content: string) =>
    ({
      id,
      pubkey,
      created_at: 1_700_000_000,
      kind: 42,
      tags: [],
      content,
      sig: "",
    }) as unknown as NostrEvent;

  it("前の鍵で書いた発言も、いまの鍵の発言と並んで表示される", async () => {
    // いまの端末は一時鍵で参加している（＝自動再参加が成立する状態）
    ephemeralKey = { secret: "00" };
    chatQuery = { data: CHAT_WITH_OLD_KEY };
    await renderChat("page");
    // 自動再参加が成立しないと購読が始まらない（許可リストの先頭が前の鍵でも
    // 自分の鍵として扱えること）
    await waitFor(() => expect(deliver).not.toBeNull());
    await act(async () => {
      deliver!(message("note-old", "pk-old", "前の端末からの発言"));
      deliver!(message("note-new", "pk-me", "いまの端末からの発言"));
      // 許可リストに無い鍵（外部のクライアント等）は誰の発言としても出さない
      deliver!(message("note-x", "pk-unknown", "許可リスト外の発言"));
    });

    expect(await screen.findByText("前の端末からの発言")).toBeInTheDocument();
    expect(screen.getByText("いまの端末からの発言")).toBeInTheDocument();
    expect(screen.queryByText("許可リスト外の発言")).not.toBeInTheDocument();
    // どちらも自分の発言として同じ表示名が付く
    expect(screen.getAllByText("わたし")).toHaveLength(2);
  });

  it("他人の鍵の発言は他人の名前で出る（自分のものとして扱わない）", async () => {
    ephemeralKey = { secret: "00" };
    chatQuery = { data: CHAT_WITH_OLD_KEY };
    await renderChat("page");
    await waitFor(() => expect(deliver).not.toBeNull());
    await act(async () => {
      deliver!(message("note-other", "pk-other", "他人からの発言"));
    });

    expect(await screen.findByText("他人からの発言")).toBeInTheDocument();
    expect(screen.getByText("だれか")).toBeInTheDocument();
    expect(screen.queryByText("わたし")).not.toBeInTheDocument();
  });
});

/**
 * 再読み込み時の自動再参加 (#223) と、前回選んだ発言手段の尊重 (#332)。
 *
 * サーバーは一時鍵を消さずに持ち続けるので、「一時鍵が取れるか」だけで判断すると
 * 一度でも一時鍵を使った人は再読み込みのたびに黙って一時鍵へ戻される。
 * 本人の鍵で発言する選択が告知なく失われるので、**前回の選択**で分ける。
 */
describe("再読み込み時の自動再参加と前回の選択 (#332)", () => {
  /** 前回この画面で選んだ発言手段の記憶先（イベント単位）。
   * 覚えるのは選択だけで、鍵や個人を特定できる値は入れない */
  const MODE_KEY = "eventer:chatKeyMode:e-1";

  it("前回「自分の鍵」を選んだ人は、一時鍵が取れても勝手に切り替わらない", async () => {
    // サーバーには一時鍵が残っており、その鍵は許可リストにも載っている
    // （＝この分岐が無いと自動再参加が必ず成立してしまう状況）
    ephemeralKey = { secret: "00" };
    localStorage.setItem(MODE_KEY, "nip07");
    await renderChat("page");

    // 参加UIが出て、選び直せる
    expect(
      await screen.findByRole("button", { name: "チャットに参加する" }),
    ).toBeInTheDocument();
    // 前回の選択が選ばれた状態で出る
    expect(screen.getByLabelText("Nostrアカウントで発言")).toBeChecked();
    expect(screen.getByLabelText("イベント用の一時鍵で発言")).not.toBeChecked();
    // 一時鍵の署名器で購読を始めていない
    expect(deliver).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("前回「一時鍵」だった人は、これまでどおり自動で繋がる", async () => {
    ephemeralKey = { secret: "00" };
    localStorage.setItem(MODE_KEY, "ephemeral");
    await renderChat("page");

    await waitFor(() => expect(deliver).not.toBeNull());
    expect(
      screen.queryByRole("button", { name: "チャットに参加する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("まだ何も選んでいない人は、これまでどおり自動で繋がる（既定は変えない）", async () => {
    ephemeralKey = { secret: "00" };
    await renderChat("page");

    await waitFor(() => expect(deliver).not.toBeNull());
    expect(
      screen.queryByRole("button", { name: "チャットに参加する" }),
    ).not.toBeInTheDocument();
  });

  it("別のイベントの選択に引きずられない（記憶はイベント単位）", async () => {
    ephemeralKey = { secret: "00" };
    localStorage.setItem("eventer:chatKeyMode:e-999", "nip07");
    await renderChat("page");

    await waitFor(() => expect(deliver).not.toBeNull());
  });

  it("localStorage が使えない環境でも壊れず、自動で繋がる", async () => {
    // プライベートウィンドウ等で getItem/setItem が例外を投げる状態を作る
    const boom = () => {
      throw new Error("no storage");
    };
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    try {
      ephemeralKey = { secret: "00" };
      await renderChat("page");
      await waitFor(() => expect(deliver).not.toBeNull());
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("参加したときに、実際に使った手段を覚える", async () => {
    // 一時鍵が無い＝自動再参加が成立せず、参加UIから入る状態
    await renderChat("page");
    const button = await screen.findByRole("button", {
      name: "チャットに参加する",
    });
    await act(async () => {
      button.click();
    });

    expect(localStorage.getItem(MODE_KEY)).toBe("ephemeral");
  });
});

describe("チャットに繋がせない状態 (#283)", () => {
  const unavailableQuery = {
    data: CHAT,
    error: new ApiError(403, { error: "chat_unavailable" }),
  };

  it("理由を書かず、参加UI・入力欄・メッセージ・リレー接続のいずれも出さない", async () => {
    ephemeralKey = { secret: "00" };
    chatQuery = unavailableQuery;
    await renderChat("page");

    expect(
      screen.getByText("このイベントのチャットに接続できません。"),
    ).toBeInTheDocument();
    // 理由は明かさない。嘘（不調・回線）も書かない
    expect(screen.queryByText(/締め出/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ネットワーク|回線|不調/)).not.toBeInTheDocument();
    // 参加もできず、この画面からは投稿もできない
    expect(
      screen.queryByRole("button", { name: "チャットに参加する" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // リレーの購読も始めない（署名器を持っていても繋がない）
    expect(deliver).toBeNull();
  });

  it("投影用画面でも「まだメッセージがありません」ではなくこの文言を出す", async () => {
    chatQuery = unavailableQuery;
    await renderChat("display");

    expect(
      screen.getByText("このイベントのチャットに接続できません。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("まだ表示できるメッセージがありません。"),
    ).not.toBeInTheDocument();
  });

  it("403 でも別の理由ならこの文言は出さない", async () => {
    chatQuery = { error: new ApiError(403, { error: "forbidden" }) };
    await renderChat("page");

    expect(
      screen.queryByText("このイベントのチャットに接続できません。"),
    ).not.toBeInTheDocument();
  });

  it("同じ error 名でも 403 以外ならこの文言は出さない", async () => {
    // 別のエンドポイントが同じ名前を別のステータスで返し始めても、
    // 無関係な失敗をこの画面に吸い込ませない
    chatQuery = { error: new ApiError(500, { error: "chat_unavailable" }) };
    await renderChat("page");

    expect(
      screen.queryByText("このイベントのチャットに接続できません。"),
    ).not.toBeInTheDocument();
  });
});

/**
 * 参加ボタンを押したときの失敗の出し分け (#283)。
 *
 * 締め出しは許可リストの取得が落ちる前に押される（ポーリングの間・リトライ中）ので、
 * 参加ボタン側にも同じ 403 が返ってくる。
 * **締め出された人は参加が確定している**ので、ここで「参加が確定しているメンバーのみ」
 * と出すと事実と違う説明になる。理由は書かないが、嘘も書かない。
 */
describe("参加ボタンが 403 で失敗したとき (#283)", () => {
  const NOT_CONFIRMED_TEXT = "参加が確定しているメンバーのみチャットを利用できます。";

  /** 参加UI（署名器が決まっていない状態）を出して「チャットに参加する」を押す */
  async function clickJoin() {
    await renderChat("page");
    const button = await screen.findByRole("button", {
      name: "チャットに参加する",
    });
    await act(async () => {
      button.click();
    });
  }

  it("締め出しなら、参加が確定していないとは書かない", async () => {
    joinResult = async () => {
      throw new ApiError(403, { error: "chat_unavailable" });
    };
    await clickJoin();

    expect(
      await screen.findByText("このイベントのチャットに接続できません。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_CONFIRMED_TEXT)).not.toBeInTheDocument();
  });

  it("参加確定前の 403 は従来どおりの文言（上の確認の空振り防止）", async () => {
    joinResult = async () => {
      throw new ApiError(403, { error: "forbidden" });
    };
    await clickJoin();

    expect(await screen.findByText(NOT_CONFIRMED_TEXT)).toBeInTheDocument();
    expect(
      screen.queryByText("このイベントのチャットに接続できません。"),
    ).not.toBeInTheDocument();
  });

  it("key_not_linked（本人の鍵だがアカウントに未登録）なら専用の文言を出す", async () => {
    joinResult = async () => {
      throw new ApiError(403, { error: "key_not_linked" });
    };
    await clickJoin();

    expect(
      await screen.findByText(
        "この鍵はあなたのアカウントに登録されていません。同じ鍵でサインインしてアカウントに登録するか、イベント用の一時鍵で参加してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_CONFIRMED_TEXT)).not.toBeInTheDocument();
    expect(
      screen.queryByText("このイベントのチャットに接続できません。"),
    ).not.toBeInTheDocument();
  });

  it("too_many_keys（登録できる鍵の上限到達）なら専用の文言を出す", async () => {
    joinResult = async () => {
      throw new ApiError(409, { error: "too_many_keys" });
    };
    await clickJoin();

    expect(
      await screen.findByText(
        "このイベントで使える鍵の数の上限に達しました。イベント用の一時鍵で参加してください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_CONFIRMED_TEXT)).not.toBeInTheDocument();
  });
});
