/** Discord / Slack 通知（Webhook）の文言 (docs/webhooks.md) */
const ja = {
  title: "通知（Discord / Slack）",
  introCommunity:
    "このコミュニティが主催・共催するイベントで、問い合わせ・参加・キャンセルがあったときに Discord や Slack のチャンネルへ知らせます。",
  introEvent:
    "このイベントだけの通知です。主催と共催の運営で同じチャンネルを見たいときに使えます。",
  urlLabel: "Webhook URL",
  urlHelp: "Discord（チャンネルの設定 → 連携サービス → ウェブフック）か Slack（Incoming Webhooks）の URL を貼ってください。",
  labelLabel: "メモ（任意）",
  topicInquiry: "問い合わせ",
  topicJoin: "参加",
  topicCancel: "キャンセル",
  add: "追加する",
  empty: "まだ登録されていません。",
  test: "テスト送信",
  testOk: "送れました。チャンネルを確認してください。",
  testFailed: "送れませんでした（{{status}}）。URL を確認してください。",
  remove: "削除",
  removeConfirm: "この通知を削除しますか？",
  stopped: "停止中",
  stoppedHelp: "続けて送れなかったので止めました（{{error}}）。URL を直してから再開してください。",
  resume: "再開する",
  lastSent: "最後に送った日時: {{time}}",
  urlInvalid: "Discord か Slack の Webhook URL を入れてください。",
  limit: "これ以上は登録できません（{{limit}} 個まで）。",
  saveFailed: "保存できませんでした。",
};

const en: Record<keyof typeof ja, string> = {
  title: "Notifications (Discord / Slack)",
  introCommunity:
    "Post to a Discord or Slack channel when someone sends an inquiry, joins or cancels on an event this community hosts or co-hosts.",
  introEvent: "Notifications for this event only. Useful when host and co-host organizers want to watch the same channel.",
  urlLabel: "Webhook URL",
  urlHelp: "Paste a Discord (channel settings → Integrations → Webhooks) or Slack (Incoming Webhooks) URL.",
  labelLabel: "Note (optional)",
  topicInquiry: "Inquiries",
  topicJoin: "Joins",
  topicCancel: "Cancellations",
  add: "Add",
  empty: "No webhooks yet.",
  test: "Send test",
  testOk: "Sent. Check the channel.",
  testFailed: "Could not send ({{status}}). Check the URL.",
  remove: "Delete",
  removeConfirm: "Delete this notification?",
  stopped: "Stopped",
  stoppedHelp: "Stopped after repeated failures ({{error}}). Fix the URL and resume.",
  resume: "Resume",
  lastSent: "Last sent: {{time}}",
  urlInvalid: "Enter a Discord or Slack webhook URL.",
  limit: "You can't add more (up to {{limit}}).",
  saveFailed: "Could not save.",
};

export const webhooks = { ja, en };
