import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PersonRemoveOutlinedIcon from "@mui/icons-material/PersonRemoveOutlined";
import { useTranslation } from "react-i18next";
import {
  DUTY_REQUIRED_MAX,
  type DutyCandidate,
  type StaffDuty,
} from "@eventer/shared";
import { i18next } from "../i18n/index.js";
import { errorMessage } from "../lib/errorMessage.js";
import type { SlotBoard } from "../lib/dutyBoard.js";

/** 保存できなかった理由。コードの綴りをそのまま出さず、その場で直せる形で書く */
export function dutyErrorMessage(error: unknown): string {
  return errorMessage(error, {
    duty_limit: i18next.t("staffOps.dutyLimitError"),
    duty_name_taken: i18next.t("staffOps.dutyNameTakenError"),
    duty_slot_limit: i18next.t("staffOps.dutySlotLimitError"),
    duty_required_range: i18next.t("staffOps.dutyRequiredRangeError"),
    duty_assignee_not_staff: i18next.t("staffOps.dutyAssigneeNotStaffError"),
    duty_assignee_limit: i18next.t("staffOps.dutyAssigneeLimitError"),
    duty_assignee_dup: i18next.t("staffOps.dutyAssigneeDupError"),
    default: i18next.t("staffOps.saveFailed"),
  });
}

/**
 * 1つの時間帯の持ち場と割り当て (#384 案S2 のダイアログ)。
 *
 * 2段階（要件2）が画面の形にも残る:
 * - 上段: この時間帯の**持ち場**（役割 × 必要人数）。保存は宣言型の PUT 1本
 * - 下段: 既にある持ち場への**割り当て**（1件ずつの POST / DELETE）
 *
 * 割り当てを保ったまま人数だけ変えられる（サーバーが duty_id で差分を取る）。
 * 持ち場を外すと割り当ても消えるので、**外す前に確認を取る**（設計 6.2）。
 */
export function DutySlotsDialog({
  itemTitle,
  boards,
  duties,
  assignable,
  busy,
  error,
  onPutSlots,
  onAddAssignee,
  onRemoveAssignee,
  onClose,
}: {
  itemTitle: string;
  /** この時間帯の持ち場（充足の導出済み） */
  boards: SlotBoard[];
  duties: StaffDuty[];
  assignable: DutyCandidate[];
  busy: boolean;
  error: unknown;
  onPutSlots: (slots: Array<{ dutyId: string; required: number }>) => void;
  onAddAssignee: (slotId: string, userId: string) => void;
  onRemoveAssignee: (slotId: string, assigneeId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [addDutyId, setAddDutyId] = useState("");
  /** 割り当ての選択（持ち場ごと） */
  const [picking, setPicking] = useState<Record<string, string>>({});

  const usedDutyIds = new Set(boards.map((b) => b.slot.dutyId));
  const addable = duties.filter((d) => !usedDutyIds.has(d.id));

  /** いまの持ち場一式を宣言型の形に写す（1か所だけ差し替えて送る） */
  const currentSlots = () =>
    boards.map((b) => ({
      dutyId: b.slot.dutyId,
      required: b.slot.requiredCount,
    }));

  const addSlot = () => {
    if (!addDutyId) return;
    onPutSlots([...currentSlots(), { dutyId: addDutyId, required: 1 }]);
    setAddDutyId("");
  };

  const setRequired = (dutyId: string, required: number) => {
    if (!Number.isInteger(required) || required < 1 || required > DUTY_REQUIRED_MAX)
      return;
    onPutSlots(
      currentSlots().map((s) => (s.dutyId === dutyId ? { ...s, required } : s)),
    );
  };

  const removeSlot = (board: SlotBoard) => {
    if (
      board.slot.assignees.length > 0 &&
      !window.confirm(
        t("staffOps.dutySlotRemoveConfirm", { name: board.dutyName }),
      )
    ) {
      return;
    }
    onPutSlots(currentSlots().filter((s) => s.dutyId !== board.slot.dutyId));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t("staffOps.dutySlotsDialogTitle")}
        <Typography variant="body2" color="text.secondary">
          {itemTitle}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error != null && (
            <Alert severity="error">{dutyErrorMessage(error)}</Alert>
          )}

          {boards.map((board) => {
            // 既に active で入っている人は選択肢から外す（選んでも dup で弾かれるだけ）
            const activeIds = new Set(
              board.slot.assignees
                .filter((a) => a.state === "active" && a.user)
                .map((a) => a.user!.id),
            );
            const candidates = assignable.filter((u) => !activeIds.has(u.id));
            const picked = picking[board.slot.id] ?? "";
            return (
              <Stack key={board.slot.id} spacing={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ flexGrow: 1 }} fontWeight={600}>
                    {board.dutyName}
                  </Typography>
                  <Chip
                    size="small"
                    label={`${board.activeCount}/${board.slot.requiredCount}`}
                    color={board.shortage > 0 ? "warning" : "default"}
                  />
                  <TextField
                    type="number"
                    size="small"
                    label={t("staffOps.dutyRequiredLabel")}
                    value={board.slot.requiredCount}
                    onChange={(e) =>
                      setRequired(board.slot.dutyId, Number(e.target.value))
                    }
                    disabled={busy}
                    sx={{ width: 110 }}
                    slotProps={{
                      htmlInput: { min: 1, max: DUTY_REQUIRED_MAX },
                    }}
                  />
                  <IconButton
                    size="small"
                    disabled={busy}
                    onClick={() => removeSlot(board)}
                    aria-label={t("staffOps.dutySlotRemove")}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>

                {/* 外れた担当が居ることは伝えるが、**名前は出さない**（設計 6.3） */}
                {board.leftCount > 0 && (
                  <Alert severity="warning">
                    {t("staffOps.dutyAssigneeLeft")}
                  </Alert>
                )}

                <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                  {board.slot.assignees.map((a) => (
                    <Chip
                      key={a.id}
                      size="small"
                      color={a.state === "left" ? "warning" : "default"}
                      label={
                        a.state === "active" && a.user
                          ? a.user.globalName || a.user.username
                          : t("staffOps.dutyAssigneeLeftShort")
                      }
                      onDelete={
                        busy
                          ? undefined
                          : () => onRemoveAssignee(board.slot.id, a.id)
                      }
                      deleteIcon={<PersonRemoveOutlinedIcon />}
                    />
                  ))}
                </Stack>

                <Stack direction="row" spacing={1}>
                  <TextField
                    select
                    size="small"
                    fullWidth
                    label={t("staffOps.dutyAssignLabel")}
                    value={picked}
                    onChange={(e) =>
                      setPicking((prev) => ({
                        ...prev,
                        [board.slot.id]: e.target.value,
                      }))
                    }
                    disabled={busy || candidates.length === 0}
                  >
                    {candidates.map((u) => (
                      <MenuItem key={u.id} value={u.id}>
                        {u.globalName || u.username}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={busy || !picked}
                    onClick={() => {
                      onAddAssignee(board.slot.id, picked);
                      setPicking((prev) => ({ ...prev, [board.slot.id]: "" }));
                    }}
                  >
                    {t("staffOps.dutyAssignButton")}
                  </Button>
                </Stack>
              </Stack>
            );
          })}

          {duties.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("staffOps.dutyNoDuties")}
            </Typography>
          ) : (
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                fullWidth
                label={t("staffOps.dutySlotAdd")}
                value={addDutyId}
                onChange={(e) => setAddDutyId(e.target.value)}
                disabled={busy || addable.length === 0}
              >
                {addable.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.name}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="outlined"
                disabled={busy || !addDutyId}
                onClick={addSlot}
              >
                {t("staffOps.dutyAddButton")}
              </Button>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
