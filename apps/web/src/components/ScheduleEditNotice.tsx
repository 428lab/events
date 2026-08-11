import { Alert, AlertTitle, Button, Typography } from "@mui/material";
import type { ScheduleEditingUser } from "@eventer/shared";

/** 編集中の人の呼び方 (#340)。
 * 表示名が取れないとき（退会申請中など #250）は名前を出さずに言い換える。
 * 「◯◯さん」と「ほかの運営メンバー」を文の中で作り分けると同じ文が2つに
 * 分かれるので、呼び方だけをここで決めて文は1つにする */
export function editorLabel(editor: ScheduleEditingUser): string {
  return editor.name ? `${editor.name}さん` : "ほかの運営メンバー";
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
  return (
    <Alert severity="info">
      <Typography variant="body2" fontWeight={600}>
        {editorLabel(editor)}がいまタイムテーブルを編集しています。
      </Typography>
      <Typography variant="body2">
        このまま編集できますが、先に相手が保存すると、あとから保存したほうは
        上書きを避けるために止まります。担当を分けるか、相手の保存を待ってから
        保存してください。
      </Typography>
    </Alert>
  );
}

/** 保存が版の食い違いで止められたときのお知らせ (#340)。
 *
 * 利用者がこの後に何をすればよいかまで書く。読み込み直すと手元の編集は
 * 消えるので、**控えてから押す**ところまで案内しないと、案内どおりに
 * 押した人が編集内容を失う */
export function ScheduleConflictAlert({ onReload }: { onReload: () => void }) {
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onReload}>
          最新を読み込む
        </Button>
      }
    >
      <AlertTitle>ほかの人が先にタイムテーブルを更新しました</AlertTitle>
      <Typography variant="body2">
        あなたが編集を始めたあとに更新が入ったため、相手の変更を消さないよう
        保存を中止しました。いまの編集内容はこの画面に残っています。
      </Typography>
      <Typography variant="body2">
        変えたかった箇所を控えてから「最新を読み込む」を押し、最新の
        タイムテーブルに入れ直してください。
      </Typography>
    </Alert>
  );
}
