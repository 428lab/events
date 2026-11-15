import { useEffect, useRef, useState } from "react";
import type { BingoStatus, BingoStatusRow } from "@eventer/shared";
import type { BingoCutin } from "./useBingoScreenEffects.js";

/** 名前入りの一覧（staff の `GET /bingo/status`）は、人数を運ぶ合図より少し前後して届く。
 * カットインを出した時刻からこれだけ前までに新しくビンゴになった人を、そのカットインの人とみなす */
export const BINGO_NAME_MATCH_MS = 3_000;

interface Fresh {
  row: BingoStatusRow;
  at: number;
}

/**
 * ビンゴのカットインに出す名前 (#681 PR3・案N1)。投影を staff で開いているときだけ、
 * staff 専用の一覧（`useBingoStatus`）を渡してもらい、前回の一覧より新しくビンゴになった人を拾う。
 * staff でなければ `status` は undefined のまま（一覧を取りに行かない）で、名前は常に空。
 *
 * - 最初の一覧は基準にするだけ（開き直しで名前を出さない）
 * - 一覧からビンゴが消えた人（取り消し・リセット）は基準から外す。もう一度ビンゴになれば新しく拾う
 * - カットインの表示中に一覧が届けば、その場で名前が足される（人数は先に出ている）
 */
export function useBingoCutinNames(
  status: BingoStatus | undefined,
  cutin: BingoCutin | null,
): BingoStatusRow[] {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Fresh[]>([]);
  const rows = status?.rows;

  useEffect(() => {
    if (!rows) return;
    const winners = new Set(rows.filter((r) => r.bingo).map((r) => r.userId));
    const before = known.current;
    known.current = winners;
    if (!before) return;
    const added = rows.filter((r) => r.bingo && !before.has(r.userId));
    if (added.length === 0) return;
    const now = Date.now();
    setFresh((list) => [
      // 古いものは捨てる（カットインに使える窓より前）
      ...list.filter((f) => now - f.at < BINGO_NAME_MATCH_MS * 4),
      ...added.map((row) => ({ row, at: now })),
    ]);
  }, [rows]);

  if (!cutin) return [];
  // 窓の中の新しい順に、増えた人数ぶんだけ（続けて出たカットインの前の人を混ぜない）
  return fresh
    .filter((f) => f.at >= cutin.at - BINGO_NAME_MATCH_MS)
    .slice(-cutin.n)
    .map((f) => f.row);
}
