import { describe, it, expect } from "vitest";
import {
  deferBackground,
  runWithExecutionContext,
} from "../src/runtime.js";

/** waitUntil に渡された Promise を記録するだけの ExecutionContext */
function recordingCtx(): {
  ctx: ExecutionContext;
  seen: Promise<unknown>[];
} {
  const seen: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      seen.push(p);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, seen };
}

describe("背景処理の実行文脈はリクエストごと (#317)", () => {
  it("A が待っている間に B が入っても、A の背景処理は A の ctx に付く", async () => {
    const a = recordingCtx();
    const b = recordingCtx();

    // A がネットワーク待ちに入ったことを B に知らせる関門
    let releaseA = (): void => {};
    const aReachedNetworkWait = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let letAContinue = (): void => {};
    const aMayContinue = new Promise<void>((resolve) => {
      letAContinue = resolve;
    });

    const workA = Promise.resolve("A の背景処理");
    const workB = Promise.resolve("B の背景処理");

    // リクエストA: 途中で待ちに入り、そのあと背景処理を積む
    const requestA = runWithExecutionContext(a.ctx, async () => {
      releaseA();
      await aMayContinue;
      await deferBackground(workA);
    });

    // リクエストB: A が待っている最中に丸ごと走りきる
    await aReachedNetworkWait;
    await runWithExecutionContext(b.ctx, async () => {
      await deferBackground(workB);
    });

    // B が終わってから A を再開させる
    letAContinue();
    await requestA;

    expect(a.seen).toEqual([workA]);
    expect(b.seen).toEqual([workB]);
  });

  it("実行文脈の外では waitUntil せずその場で待つ", async () => {
    let done = false;
    await deferBackground(
      (async () => {
        done = true;
      })(),
    );
    expect(done).toBe(true);
  });

  it("入れ子の文脈は内側が勝ち、抜ければ外側に戻る", async () => {
    const outer = recordingCtx();
    const inner = recordingCtx();
    const outerWork = Promise.resolve("outer");
    const innerWork = Promise.resolve("inner");

    await runWithExecutionContext(outer.ctx, async () => {
      await runWithExecutionContext(inner.ctx, () =>
        deferBackground(innerWork),
      );
      await deferBackground(outerWork);
    });

    expect(inner.seen).toEqual([innerWork]);
    expect(outer.seen).toEqual([outerWork]);
  });
});
