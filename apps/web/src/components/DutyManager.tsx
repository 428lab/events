import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useTranslation } from "react-i18next";
import { DUTY_NAME_MAX, type DutySlot, type StaffDuty } from "@eventer/shared";

/**
 * 役割の定義の管理 (#384)。イベントごとに主催者が作る。
 *
 * 既定のテンプレート（サービス共通の「受付」「司会」…）は**無い**（#364 の
 * 結論待ち。設計 3.4）。代わりにイベントの複製が名前ごとコピーする。
 *
 * 削除は持ち場・割り当てを道連れにする（CASCADE）ので、**使用数を出して
 * 確認を取る**（設計 6.2）。
 */
export function DutyManager({
  duties,
  slots,
  busy,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: {
  duties: StaffDuty[];
  /** 使用数（削除の確認文）を数えるためだけに見る */
  slots: DutySlot[];
  busy: boolean;
  onAdd: (name: string) => void;
  onRename: (dutyId: string, name: string) => void;
  onMove: (dutyId: string, delta: -1 | 1) => void;
  onDelete: (dutyId: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<StaffDuty | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const usage = (dutyId: string) =>
    slots.filter((s) => s.dutyId === dutyId).length;

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  };

  const del = (duty: StaffDuty) => {
    const n = usage(duty.id);
    const message =
      n > 0
        ? t("staffOps.dutyDeleteConfirm", { name: duty.name, n })
        : t("staffOps.dutyDeleteConfirmUnused", { name: duty.name });
    if (!window.confirm(message)) return;
    onDelete(duty.id);
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">{t("staffOps.dutyDefsTitle")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("staffOps.dutyDefsNote")}
        </Typography>
        <Stack spacing={0.5}>
          {duties.map((duty, i) => (
            <Stack
              key={duty.id}
              direction="row"
              alignItems="center"
              spacing={0.5}
            >
              <Typography sx={{ flexGrow: 1 }}>{duty.name}</Typography>
              <IconButton
                size="small"
                disabled={busy || i === 0}
                onClick={() => onMove(duty.id, -1)}
                aria-label="up"
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                disabled={busy || i === duties.length - 1}
                onClick={() => onMove(duty.id, 1)}
                aria-label="down"
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                disabled={busy}
                onClick={() => {
                  setRenaming(duty);
                  setRenameTo(duty.name);
                }}
                aria-label="rename"
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                disabled={busy}
                onClick={() => del(duty)}
                aria-label="delete"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t("staffOps.dutyAddPlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            slotProps={{ htmlInput: { maxLength: DUTY_NAME_MAX } }}
          />
          <Button variant="outlined" disabled={busy || !name.trim()} onClick={add}>
            {t("staffOps.dutyAddButton")}
          </Button>
        </Box>
      </CardContent>

      {renaming && (
        <Dialog open onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
          <DialogTitle>{t("staffOps.dutyRenameTitle")}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              size="small"
              sx={{ mt: 1 }}
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              slotProps={{ htmlInput: { maxLength: DUTY_NAME_MAX } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenaming(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="contained"
              disabled={busy || !renameTo.trim()}
              onClick={() => {
                onRename(renaming.id, renameTo.trim());
                setRenaming(null);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  );
}
