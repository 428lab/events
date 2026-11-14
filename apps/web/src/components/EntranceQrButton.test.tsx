import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Event } from "@eventer/shared";

/** 入場QRはファーストビューに出す。出すのは出席チェックモード＋日程確定＋終了前の確定参加者だけ */
const state = vi.hoisted(() => ({ status: "confirmed" as string }));
vi.mock("../api/hooks.js", () => ({
  useMe: () => ({ data: { id: "me", username: "me" } }),
  useEventMembers: () => ({ data: [{ id: "m", userId: "me", user: { id: "me" }, status: state.status, role: "participant" }] }),
}));
vi.mock("../lib/eventMembership.js", () => ({
  findMyMembership: (members: { userId: string; status: string }[] | undefined) => members?.[0],
}));
vi.mock("./EntranceQrDialog.js", () => ({ EntranceQrDialog: () => null }));
const { EntranceQrButton } = await import("./EntranceQrButton.js");

const event = { id: "e", attendanceCheck: true, scheduling: false } as unknown as Event;

describe("入場QRボタン", () => {
  it("確定参加者・出席チェック・終了前だけ出す。申込中・出席チェックなし・終了後は出さない", () => {
    state.status = "confirmed";
    const { rerender } = render(<EntranceQrButton eventId="e" event={event} ended={false} />);
    expect(screen.getByRole("button", { name: "入場QR" })).toBeInTheDocument();
    rerender(<EntranceQrButton eventId="e" event={event} ended />);
    expect(screen.queryByRole("button", { name: "入場QR" })).not.toBeInTheDocument();
    rerender(<EntranceQrButton eventId="e" event={{ ...event, attendanceCheck: false } as Event} ended={false} />);
    expect(screen.queryByRole("button", { name: "入場QR" })).not.toBeInTheDocument();
    state.status = "applied";
    rerender(<EntranceQrButton eventId="e" event={event} ended={false} />);
    expect(screen.queryByRole("button", { name: "入場QR" })).not.toBeInTheDocument();
  });
});
