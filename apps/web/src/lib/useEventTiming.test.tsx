import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Event } from "@eventer/shared";
import { useEventTiming } from "./useEventTiming.js";

/**
 * 終了・募集締切の判定 (#269)。
 *
 * サーバーの isEventEnded / isRegistrationClosed と対になる判定なので、
 * ずれると「参加ボタンは押せるのにサーバーに断られる」画面になる。
 * 時計を内側に持つ（開いたままのページでも締切をまたげば表示が変わる）ことまで
 * 確かめる。
 */

const NOW = new Date("2026-09-04T12:00:00+09:00").getTime();
const HOUR = 3600000;

function ev(over: Partial<Event> = {}): Event {
  return {
    id: "e-1",
    scheduling: false,
    startsAt: NOW - HOUR,
    endsAt: NOW + HOUR,
    registrationDeadline: null,
    ...over,
  } as Event;
}

/** フックの結果を DOM に出すだけの覗き窓 */
function Probe({ event }: { event: Event | null }) {
  const timing = useEventTiming(event);
  return (
    <div>
      <span data-testid="ended">{String(timing.ended)}</span>
      <span data-testid="closed">{String(timing.registrationClosed)}</span>
      <span data-testid="remaining">{timing.deadlineRemaining}</span>
    </div>
  );
}

function draw(event: Event | null) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return render(<Probe event={event} />);
}

const read = (id: string) => screen.getByTestId(id).textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe("終了の判定", () => {
  it("終了時刻を過ぎたら終了", () => {
    draw(ev({ endsAt: NOW - 1 }));
    expect(read("ended")).toBe("true");
  });

  it("終了時刻の前は終了ではない", () => {
    draw(ev({ endsAt: NOW + 1 }));
    expect(read("ended")).toBe("false");
  });

  it("日程調整中は終了扱いしない（endsAt が未確定の 0 でも）", () => {
    draw(ev({ scheduling: true, endsAt: 0 }));
    expect(read("ended")).toBe("false");
  });

  it("イベントが読めていないうちは終了扱いしない", () => {
    draw(null);
    expect(read("ended")).toBe("false");
  });
});

describe("募集締切の判定", () => {
  it("締切が未設定なら締め切らない", () => {
    draw(ev({ registrationDeadline: null }));
    expect(read("closed")).toBe("false");
    expect(read("remaining")).toBe("");
  });

  it("締切を過ぎたら締め切り", () => {
    draw(ev({ registrationDeadline: NOW }));
    expect(read("closed")).toBe("true");
  });

  it("24時間を切ったら残り時間を出す", () => {
    draw(ev({ registrationDeadline: NOW + 2 * HOUR }));
    expect(read("closed")).toBe("false");
    expect(read("remaining")).not.toBe("");
  });

  it("24時間より先の締切では残り時間を出さない（強調するのは直前だけ）", () => {
    draw(ev({ registrationDeadline: NOW + 25 * HOUR }));
    expect(read("remaining")).toBe("");
  });
});

describe("開いたままのページ", () => {
  it("1分ごとに時計が進み、締切をまたぐと締め切りに変わる", () => {
    draw(ev({ registrationDeadline: NOW + 30000 }));
    expect(read("closed")).toBe("false");

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(read("closed")).toBe("true");
  });
});
