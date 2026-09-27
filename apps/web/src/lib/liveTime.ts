export function countdownSeconds(targetMs: number | undefined, nowMs: number, zero: "stop" | "hide" = "stop"): number | null {
  if (targetMs === undefined || !Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return null;
  const remaining = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  return remaining === 0 && zero === "hide" ? null : remaining;
}
export function clockText(nowMs: number, timezone: string, seconds: boolean, date: boolean, hour12 = false): string | null {
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8640000000000000) return null;
  try {
    const time = new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12 }).format(nowMs);
    return date ? `${new Intl.DateTimeFormat("ja-JP", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs)} ${time}` : time;
  } catch { return null; }
}
/** Enumerate exact UTC instants by testing each possible quarter-hour offset (including historical offsets).
 * An absent local time has no matches; a DST overlap returns both, requiring an explicit choice. */
export function resolveLocalTarget(local: string, timezone: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const naive = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(naive)) return [];
  const result: number[] = [];
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const epoch = naive - offset * 60_000;
      const parts = Object.fromEntries(formatter.formatToParts(epoch).map(p => [p.type, p.value]));
      if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === local) result.push(epoch);
    }
  } catch { return []; }
  return result.sort((a, b) => a - b);
}
