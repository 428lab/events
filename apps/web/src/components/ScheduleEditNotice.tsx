import { Alert, AlertTitle, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ScheduleEditingUser } from "@eventer/shared";
import { i18next } from "../i18n/index.js";

/** 編集中の人の呼び方 (#340)。
 * 表示名が取れないとき（退会申請中など #250）は名前を出さずに言い換える。
 * 「◯◯さん」と「ほかの運営メンバー」を文の中で作り分けると同じ文が2つに
 * 分かれるので、呼び方だけをここで決めて文は1つにする。
 *
 * 部品ではないので `i18next.t` で引く。呼ぶ側の部品が `useTranslation` を
 * 使っているので、言語を切り替えれば描き直される */
export function editorLabel(editor: ScheduleEditingUser): string {
  return editor.name
    ? i18next.t("schedule.editorNamed", { name: editor.name })
    : i18next.t("schedule.editorOther");
}

/** 「◯◯さんが編集中」のお知らせ (#340)。
 *
 * これは**助言**で、編集も保存も止めない。実際に上書きを防いでいるのは
 * 保存時の版の突き合わせ（食い違えば ScheduleConflictAlert が出る）。
 * ここでの狙いは、保存して弾かれる前に声をかけて分担できるようにすること */
export function ScheduleEditingAlert({
  editor,
}: {
  editor: ScheduleEditingUser;
}) {
  const { t } = useTranslation();
  return (
    <Alert severity="info">
      <Typography variant="body2" fontWeight={600}>
        {t("schedule.editingBy", { editor: editorLabel(editor) })}
      </Typography>
      <Typography variant="body2">{t("schedule.editingNote")}</Typography>
    </Alert>
  );
}

/** 版の食い違い**以外**で保存が止まったときのお知らせ (#340)。
 *
 * 通信の失敗のほかに、**ずっと開いたままだった画面**もここに来る。保存には
 * 読んだ時点の版を必ず添えるので、それを送れない古い画面は受け付けられない。
 * 「失敗しました」だけだと何度押しても直らないので、読み込み直しで復帰できる
 * ことまで書く。読み込み直すと手元の編集は消えるので、控えるよう促す。
 *
 * ここに読み込み直しのボタンは置かない。通信が一時的に切れただけなら
 * もう一度押すほうが早く、その人の編集を消してしまうのは行き過ぎになる */
export function ScheduleSaveFailedAlert() {
  const { t } = useTranslation();
  return (
    <Alert severity="error">
      <AlertTitle>{t("schedule.saveFailedTitle")}</AlertTitle>
      <Typography variant="body2">{t("schedule.saveFailedBody")}</Typography>
      <Typography variant="body2">{t("schedule.saveFailedStale")}</Typography>
    </Alert>
  );
}

/** 保存が版の食い違いで止められたときのお知らせ (#340)。
 *
 * 利用者がこの後に何をすればよいかまで書く。読み込み直すと手元の編集は
 * 消えるので、**控えてから押す**ところまで案内しないと、案内どおりに
 * 押した人が編集内容を失う */
export function ScheduleConflictAlert({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onReload}>
          {t("schedule.reloadLatest")}
        </Button>
      }
    >
      <AlertTitle>{t("schedule.conflictTitle")}</AlertTitle>
      <Typography variant="body2">{t("schedule.conflictBody")}</Typography>
      <Typography variant="body2">{t("schedule.conflictHowTo")}</Typography>
    </Alert>
  );
}
