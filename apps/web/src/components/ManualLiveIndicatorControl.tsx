import { Alert, Button, Stack, Typography } from "@mui/material";
import type { EventLiveState } from "@eventer/shared";
export function ManualLiveIndicatorControl({ state, fetchError, pending, saveError, onToggle }: { state?: EventLiveState; fetchError: boolean; pending: boolean; saveError: boolean; onToggle: (on: boolean) => void }) {
  const on = !fetchError && Boolean(state?.liveIndicatorOn);
  return <Stack spacing={0.5}>
    <Typography variant="subtitle1" fontWeight={700}>配信中表示（手動） {fetchError ? "状態不明 / OFF" : on ? "ON" : "OFF"}</Typography>
    <Typography variant="caption">外部配信サービスの状態とは連動しません。配信開始前に ON、終了後は OFF にしてください。</Typography>
    <Button variant="outlined" color={on ? "error" : "primary"} disabled={pending || fetchError || !state} onClick={() => { if (window.confirm(`配信中表示を${on ? "OFF" : "ON"}に変更しますか？`)) onToggle(!on); }}>{on ? "OFF にする" : "ON にする"}</Button>
    <Typography variant="caption">最終更新: {state ? new Date(state.updatedAt).toLocaleString("ja-JP") : "未取得"} / {saveError ? "保存失敗・再試行してください" : pending ? "保存中" : "サーバーの状態を表示中"}</Typography>
    {fetchError && <Alert severity="error">状態取得失敗。配信画面の LIVE 表示は停止します。</Alert>}
  </Stack>;
}
