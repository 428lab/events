import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ATTENDED_COUNT_SQL,
  CAPACITY_TOTAL_SQL,
  PARTICIPANT_COUNT_SQL,
} from "../src/db/repositories/events.js";
import slotsSource from "../src/db/repositories/participationSlots.ts?raw";

/**
 * Migration 0107 (D-POLL-MIN Phase 3): the member/slot count subqueries read the
 * new indexes instead of the event_member table.
 *
 * Without idx_event_member_slot_status, every slot count was a full `SCAN m`.
 * Without idx_event_member_event_status, the event counts read the table row for each
 * member to check status/attended/slot_id. These checks run EXPLAIN QUERY PLAN on the
 * SQL the repositories use, so a change that stops using the indexes fails here.
 */

async function plan(sql: string, ...args: unknown[]): Promise<string[]> {
  const res = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>();
  return res.results.map((r) => r.detail);
}

describe("0107 event_member count indexes", () => {
  it("both indexes exist", async () => {
    const res = await env.DB.prepare("PRAGMA index_list(event_member)").all<{ name: string }>();
    const names = res.results.map((r) => r.name);
    expect(names).toContain("idx_event_member_slot_status");
    expect(names).toContain("idx_event_member_event_status");
  });

  it("the findById counts read idx_event_member_event_status as a covering index", async () => {
    const sql = `SELECT *,
      ${PARTICIPANT_COUNT_SQL("event.id")} AS participant_count,
      ${ATTENDED_COUNT_SQL("event.id")} AS attended_count,
      ${CAPACITY_TOTAL_SQL("event.id")} AS capacity_total
      FROM event WHERE id = ?`;
    const memberSteps = (await plan(sql, "e")).filter((d) => /^(SEARCH|SCAN) em /.test(d));
    expect(memberSteps).toHaveLength(3);
    for (const step of memberSteps) {
      expect(step).toMatch(/^SEARCH em USING COVERING INDEX idx_event_member_event_status \(event_id=\? AND status=\?/);
    }
  });

  it("the slot counts (participationSlotsRepo) search idx_event_member_slot_status instead of scanning", async () => {
    const select = slotsSource.match(/const SELECT_SLOT = `([^`]+)`/)?.[1];
    expect(select).toBeDefined();
    const steps = await plan(`${select} WHERE s.event_id = ? ORDER BY s.sort_order ASC, s.rowid ASC`, "e");
    const memberSteps = steps.filter((d) => /^(SEARCH|SCAN) m /.test(d));
    expect(memberSteps).toHaveLength(3);
    for (const step of memberSteps) {
      expect(step).toBe("SEARCH m USING COVERING INDEX idx_event_member_slot_status (slot_id=? AND status=?)");
    }
  });
});
