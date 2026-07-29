import { Tab, Tabs } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";

/** 「イベント / イベントのたまご」切り替えタブ（トップ・イベント一覧系ページ共通）。 */
export function EggTabs({
  value,
  sx,
}: {
  value: "events" | "requests";
  sx?: SxProps<Theme>;
}) {
  return (
    <Tabs
      value={value}
      sx={[
        { mb: 3, borderBottom: 1, borderColor: "divider" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Tab
        label="イベント"
        value="events"
        component={RouterLink}
        to="/"
      />
      <Tab
        label="🥚 イベントのたまご"
        value="requests"
        component={RouterLink}
        to="/requests"
      />
    </Tabs>
  );
}
