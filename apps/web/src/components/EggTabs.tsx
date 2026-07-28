import { Tab, Tabs } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** トップの「イベント / イベントのたまご」切り替えタブ。 */
export function EggTabs({ value }: { value: "events" | "requests" }) {
  return (
    <Tabs value={value} sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}>
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
