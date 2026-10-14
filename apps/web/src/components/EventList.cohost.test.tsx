import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Event } from "@eventer/shared";
import { EventList } from "./EventList.js";

/** コミュニティページの一覧で、主催でないイベント（共催 #625）にだけ「共催」を添える */
function ev(id: string, communityId: string | null): Event {
  return {
    id,
    title: `イベント ${id}`,
    subtitle: "",
    description: "",
    status: "published",
    visibility: "public",
    scheduling: false,
    startsAt: new Date("2026-08-09T13:00:00+09:00").getTime(),
    endsAt: new Date("2026-08-09T21:00:00+09:00").getTime(),
    venueType: "offline",
    attendanceCheck: false,
    participantCount: 0,
    attendedCount: 0,
    capacityTotal: null,
    communityId,
  } as unknown as Event;
}

function draw(cohostOf?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventList events={[ev("hosted", "group"), ev("cohosted", "other")]} cohostOf={cohostOf} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (id: string) => screen.getByRole("link", { name: new RegExp(`イベント ${id}`) });

describe("一覧の共催チップ (#625)", () => {
  it("主催のイベントには出さず、共催のイベントにだけ出す", () => {
    draw("group");
    expect(within(card("hosted")).queryByText("共催")).toBeNull();
    expect(within(card("cohosted")).getByText("共催")).toBeTruthy();
  });

  it("cohostOf を渡さない一覧（他の画面）では出さない", () => {
    draw();
    expect(screen.queryByText("共催")).toBeNull();
  });
});
