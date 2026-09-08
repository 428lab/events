import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { EventMemberWithUser } from "@eventer/shared";
import { MemberRow } from "./EventMemberList.js";

const member: EventMemberWithUser = {
  id: "member", eventId: "event", userId: "user", role: "participant",
  slotId: null, status: "confirmed", attended: true, attendedAt: 1, createdAt: 1,
  user: {
    id: "user", discordId: "dummy", username: "dummy",
    globalName: "ダミー参加者 01", avatarUrl: null, createdAt: 1,
  },
};

describe("参加者行の有効幅 (#497)", () => {
  it.each([
    { isStaff: true, isMe: true, attendanceCheck: false },
    { isStaff: true, isMe: false, attendanceCheck: false },
    { isStaff: true, isMe: false, attendanceCheck: true },
    { isStaff: false, isMe: false, attendanceCheck: false },
    { isStaff: false, isMe: false, attendanceCheck: true },
  ])("固定の操作余白を二重に取らない: %j", (props) => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MemberRow eventId="event" member={member} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = screen.getByRole("listitem");
    const link = screen.getByRole("link");
    // jsdomでは幅は測れないので、余白とDOMの契約を固定する。
    // 名前・操作の実際の非重複と可読幅はブラウザで検証する。
    expect(getComputedStyle(row).paddingRight || "0px").toBe("0px");
    expect(getComputedStyle(link).paddingRight).toBe("8px");
    expect(row.querySelector(".MuiListItemSecondaryAction-root")).toBeNull();
    expect(link.getAttribute("href")).toBe("/users/dummy");
    if (props.isStaff && !props.isMe) {
      expect(link.contains(screen.getByTitle("ロールを変更"))).toBe(false);
    } else {
      expect(screen.queryByTitle("ロールを変更")).toBeNull();
    }
    if (props.isStaff && props.attendanceCheck) {
      expect(link.contains(screen.getByRole("checkbox"))).toBe(false);
    }
  });
});
