import { Chip, Stack } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useTranslation } from "react-i18next";
import type { SlotBoard } from "../lib/dutyBoard.js";

/**
 * 1つの時間帯の持ち場チップ (#384 設計 8.2)。
 *
 * 「受付 1/2」の形。不足（active < required）は warning 色、充足は通常。
 * 超過はそのまま「3/2」（応援は許す設計なので、印は付けない）。
 * 自分が入っている持ち場は塗る（filled）——これが「割り当てられたスタッフに
 * タグが付いて見える」（要件4）の実体。
 *
 * **外れた担当が居る持ち場には ⚠ を出すが、名前は出さない**（除名・降格・
 * 退会申請が混ざり、退会者の秘匿が最優先。#393 と同じ規則。サーバーも
 * `"left"` では user を返さないので、出そうとしても出せないのが正しい状態）。
 *
 * 役割の**色分けはしない**（無彩色チップ＋名前だけ。`trackColors` の教訓:
 * 本数から作る色は増減で全員の色が変わる。設計 8.2）。
 */
export function DutyChips({
  boards,
  onClick,
}: {
  boards: SlotBoard[];
  onClick?: (board: SlotBoard) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {boards.map((b) => (
        <Chip
          key={b.slot.id}
          size="small"
          label={`${b.dutyName} ${b.activeCount}/${b.slot.requiredCount}`}
          color={b.shortage > 0 ? "warning" : "default"}
          variant={b.mine ? "filled" : "outlined"}
          icon={
            b.leftCount > 0 ? (
              <WarningAmberIcon
                fontSize="small"
                titleAccess={t("staffOps.dutyAssigneeLeftShort")}
              />
            ) : undefined
          }
          onClick={onClick ? () => onClick(b) : undefined}
        />
      ))}
    </Stack>
  );
}
