import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  useAddVenueAdmin,
  useRemoveVenueAdmin,
  useTransferVenue,
  useVenueAdmins,
} from "../api/venueHooks.js";

/** 会場の管理者管理＋オーナー移譲（オーナーのみ表示）。 */
export function VenueAdminsCard({ venueId }: { venueId: string }) {
  const { data: admins } = useVenueAdmins(venueId, true);
  const add = useAddVenueAdmin(venueId);
  const remove = useRemoveVenueAdmin(venueId);
  const transfer = useTransferVenue(venueId);
  const [handle, setHandle] = useState("");

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          管理者
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          管理者は会場の編集・写真の承認・オファー対応ができます（削除・管理者の変更・移譲はオーナーのみ）。
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small"
            label="ユーザー名で追加"
            placeholder="例: kojira"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!handle.trim() || add.isPending}
            onClick={() =>
              add.mutate(handle.trim(), { onSuccess: () => setHandle("") })
            }
          >
            追加
          </Button>
        </Stack>
        {add.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            追加できませんでした（ユーザー名を確認してください）。
          </Alert>
        )}
        {!admins || admins.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            管理者はまだいません。
          </Typography>
        ) : (
          <Stack spacing={1}>
            {admins.map((a) => (
              <Stack key={a.id} direction="row" spacing={1.5} alignItems="center">
                <Avatar src={a.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
                  {(a.globalName ?? a.username).charAt(0)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {a.globalName ?? a.username}{" "}
                    <Typography component="span" variant="caption" color="text.secondary">
                      @{a.username}
                    </Typography>
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label="オーナー移譲"
                  clickable
                  color="warning"
                  variant="outlined"
                  disabled={transfer.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${a.globalName ?? a.username} さんにオーナーを移譲しますか？あなたは管理者になります。`,
                      )
                    ) {
                      transfer.mutate(a.id);
                    }
                  }}
                />
                <Chip
                  size="small"
                  label="解除"
                  clickable
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                />
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
