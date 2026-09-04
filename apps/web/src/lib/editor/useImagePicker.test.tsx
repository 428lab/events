import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useImagePicker } from "./useImagePicker.js";

/**
 * 編集画面での画像の差し込み (#466 で2つのエディタから1か所に寄せた)。
 *
 * 「新しく置く」と「差し替える」で入口が2つあるので、上げ終わった URL が
 * **押した側**に返ることが要。取り違えると、差し替えたつもりが別の要素に入る。
 * 失敗を伝えないと、利用者は上がったつもりで編集を続けてしまう（保存しても
 * 画像は無い）。同じファイルを選び直せることも、失敗してやり直すときに要る。
 */

const encode = vi.hoisted(() => vi.fn());
vi.mock("../encodeImage.js", () => ({ encodeImageForUpload: encode }));

let upload: ReturnType<typeof vi.fn>;
let alerted: string[];

function Probe() {
  const picker = useImagePicker(upload);
  return (
    <div>
      {picker.input}
      <button
        data-testid="add"
        onClick={() => picker.pick((url) => alerted.push(`置いた:${url}`))}
      >
        置く
      </button>
      <button
        data-testid="replace"
        onClick={() => picker.pick((url) => alerted.push(`差し替えた:${url}`))}
      >
        差し替える
      </button>
    </div>
  );
}

/** 隠しファイル入力。hidden なのでロールでは拾えない */
const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

const file = () => new File(["x"], "a.png", { type: "image/png" });

/** ファイルを選んだことにする。上げ終わるまで待つ */
async function choose() {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file()] } });
  });
}

beforeEach(() => {
  alerted = [];
  encode.mockReset().mockResolvedValue(new Blob(["encoded"]));
  upload = vi.fn().mockResolvedValue({ url: "https://example.test/a.webp" });
  vi.spyOn(window, "alert").mockImplementation((m?: unknown) => {
    alerted.push(String(m));
  });
  render(<Probe />);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("上げ終わった URL の行き先", () => {
  it("押した側に返る", async () => {
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(alerted).toEqual(["置いた:https://example.test/a.webp"]);
  });

  it("入口を変えると受け取り先も入れ替わる", async () => {
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    fireEvent.click(screen.getByTestId("replace"));
    await choose();
    expect(alerted[1]).toBe("差し替えた:https://example.test/a.webp");
  });

  it("上げる前に縮める", async () => {
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(encode).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(await encode.mock.results[0].value);
  });
});

describe("失敗したとき", () => {
  it("上げられなければ知らせる", async () => {
    upload.mockRejectedValue(new Error("upload_failed"));
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(alerted).toEqual([
      "画像のアップロードに失敗しました（6MBまで）",
    ]);
  });

  it("縮められなくても知らせる", async () => {
    encode.mockRejectedValue(new Error("decode_failed"));
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(alerted).toEqual([
      "画像のアップロードに失敗しました（6MBまで）",
    ]);
  });

  it("失敗しても受け取り先は呼ばない（空の URL を置かない）", async () => {
    upload.mockRejectedValue(new Error("upload_failed"));
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(alerted.some((m) => m.startsWith("置いた:"))).toBe(false);
  });
});

/**
 * 「空へ戻した」ことを数える。
 *
 * jsdom のファイル入力は値にファイル名を持てない（空文字以外の代入は弾かれる）ので、
 * 戻したあとの値を見ても元から空と区別がつかない。**代入そのもの**を見張る。
 */
function watchClear() {
  const input = fileInput();
  const desc = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!;
  const count = { cleared: 0 };
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => desc.get!.call(input),
    set: (v: string) => {
      if (v === "") count.cleared += 1;
      desc.set!.call(input, v);
    },
  });
  return count;
}

describe("選び直し", () => {
  it("選んだあとに入力を空へ戻す（同じファイルをもう一度選べる）", async () => {
    // 値が残っていると同じファイルでは change が起きず、やり直せなくなる
    const count = watchClear();
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(count.cleared).toBe(1);
  });

  it("失敗したあとも空へ戻す（やり直せないと詰む）", async () => {
    upload.mockRejectedValue(new Error("upload_failed"));
    const count = watchClear();
    fireEvent.click(screen.getByTestId("add"));
    await choose();
    expect(count.cleared).toBe(1);
  });

  it("空へ戻すのは上げ始める前（待っている間に選び直せる）", async () => {
    const count = watchClear();
    fireEvent.click(screen.getByTestId("add"));
    let cleared = -1;
    upload.mockImplementation(async () => {
      cleared = count.cleared;
      return { url: "https://example.test/a.webp" };
    });
    await choose();
    expect(cleared).toBe(1);
  });

  it("選ばずに閉じたときは何もしない", async () => {
    fireEvent.click(screen.getByTestId("add"));
    await act(async () => {
      fireEvent.change(fileInput(), { target: { files: [] } });
    });
    expect(upload).not.toHaveBeenCalled();
    expect(alerted).toEqual([]);
  });
});
