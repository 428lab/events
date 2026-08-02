import { Box } from "@mui/material";
import { EventsBrowser } from "../components/EventsBrowser.js";
import { EggTabs } from "../components/EggTabs.js";

/** トップの「続きを見る」導線から来る /events/upcoming。
 * 旧 after パラメータは廃止し、共通のイベント一覧ブラウザを表示する。 */
export function UpcomingEventsPage() {
  return (
    <Box>
      <EggTabs value="events" />
      <EventsBrowser />
    </Box>
  );
}
