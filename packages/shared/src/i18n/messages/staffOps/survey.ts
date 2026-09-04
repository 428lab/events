/** 開催前アンケート (#444)。実装の語は出さず、振る舞いで書く。 */
const ja = {
  /* ── 開催前アンケート (#444)。実装の語は出さず振る舞いで書く ── */
  preSurveyTitle: "開催前アンケート",
  preSurveyStaffOnly: "開催前アンケートはスタッフ専用です。",
  preSurveyIntro:
    "公開前のイベントについて、URLを知っている人に匿名で聞けるアンケートです。イベント本体の情報（タイトル・日時など）は回答ページに表示されません。伝えたいことはアンケートのタイトルや説明に書いてください。",
  preSurveyCreate: "アンケートを作る",
  preSurveyFormTitle: "アンケートのタイトル",
  preSurveyFormDescription: "説明（回答ページに表示されます）",
  preSurveySave: "保存",
  preSurveySaved: "保存しました。",
  preSurveySaveFailed: "保存に失敗しました。",
  preSurveyShareHeading: "共有URL",
  preSurveyShareNote:
    "このURLを知っている人は誰でも回答できます（1人1回の制限はありません。厳密な投票には使えません）。回答は匿名で、回答者が自分で選んだときだけ記名になります。",
  preSurveyCopyUrl: "URLをコピー",
  preSurveyCopied: "コピーしました。",
  preSurveyRotate: "URLを再発行",
  preSurveyRotateConfirm:
    "URLを再発行しますか？いま配布済みのURLは使えなくなります（回答は残ります）。",
  preSurveyClose: "回答を締め切る",
  preSurveyCloseConfirm: "回答を締め切りますか？（あとで再開できます）",
  preSurveyReopen: "受付を再開する",
  preSurveyDelete: "アンケートを削除",
  preSurveyDeleteConfirm:
    "アンケートを削除しますか？集まった回答もすべて消えます。",
  preSurveyResponses: "回答 {{n}}件",
  preSurveyNamedCount: "記名 {{n}}件",
  preSurveyResultsHeading: "結果",
  preSurveyAccessHeading: "アクセス",
  preSurveyAccessNote:
    "共有URLが表示された回数です。日ごとの件数だけを記録し、個人を特定する情報は保存していません。初回訪問は端末ごとのおおよその値です。",
  preSurveyAccessDay: "日付",
  preSurveyAccessViews: "のべ表示",
  preSurveyAccessFirst: "初回訪問",
  preSurveyAccessResponses: "回答",
  preSurveyAccessEmpty: "まだアクセスはありません。",
  preSurveyViewSummary: "集計",
  preSurveyViewTable: "回答一覧",
  preSurveyColTime: "回答日時",
  preSurveyColRespondent: "回答者",
  preSurveyAnonRespondent: "匿名",
  preSurveyCsvDownload: "CSVをダウンロード",
  preSurveyCsvFileName: "開催前アンケート回答.csv",
  preSurveyNoResponses: "まだ回答はありません。",
  preSurveyEditNote:
    "質問の変更は保存した時点で反映されます。質問を削除するとその回答も消えます。",
  preSurveyPublishedNote:
    "イベントは公開済みです。役目を終えたら締め切りましょう。",
} as const;

const en: Record<keyof typeof ja, string> = {
  preSurveyTitle: "Pre-event survey",
  preSurveyStaffOnly: "The pre-event survey is for organizers only.",
  preSurveyIntro:
    "Ask people who have the URL about your unpublished event, anonymously. The event itself (title, dates, etc.) is never shown on the answer page — put anything you want to share in the survey title or description.",
  preSurveyCreate: "Create a survey",
  preSurveyFormTitle: "Survey title",
  preSurveyFormDescription: "Description (shown on the answer page)",
  preSurveySave: "Save",
  preSurveySaved: "Saved.",
  preSurveySaveFailed: "Failed to save.",
  preSurveyShareHeading: "Share URL",
  preSurveyShareNote:
    "Anyone with this URL can respond (no one-per-person limit; not suitable for strict voting). Responses are anonymous unless the respondent chooses to attach their account.",
  preSurveyCopyUrl: "Copy URL",
  preSurveyCopied: "Copied.",
  preSurveyRotate: "Regenerate URL",
  preSurveyRotateConfirm:
    "Regenerate the URL? Links you have already shared will stop working (responses are kept).",
  preSurveyClose: "Close responses",
  preSurveyCloseConfirm: "Close responses? (You can reopen later.)",
  preSurveyReopen: "Reopen responses",
  preSurveyDelete: "Delete survey",
  preSurveyDeleteConfirm:
    "Delete this survey? All collected responses will be removed.",
  preSurveyResponses: "{{n}} responses",
  preSurveyNamedCount: "Named: {{n}}",
  preSurveyResultsHeading: "Results",
  preSurveyAccessHeading: "Access",
  preSurveyAccessNote:
    "How many times the share URL was viewed. Only daily counts are stored; nothing that could identify a person. First visits are approximate, per device.",
  preSurveyAccessDay: "Date",
  preSurveyAccessViews: "Total views",
  preSurveyAccessFirst: "First visits",
  preSurveyAccessResponses: "Responses",
  preSurveyAccessEmpty: "No visits yet.",
  preSurveyViewSummary: "Summary",
  preSurveyViewTable: "Responses",
  preSurveyColTime: "Submitted at",
  preSurveyColRespondent: "Respondent",
  preSurveyAnonRespondent: "Anonymous",
  preSurveyCsvDownload: "Download CSV",
  preSurveyCsvFileName: "pre-event-survey-responses.csv",
  preSurveyNoResponses: "No responses yet.",
  preSurveyEditNote:
    "Question changes take effect when you save. Deleting a question also deletes its answers.",
  preSurveyPublishedNote:
    "The event is published. Close the survey once it has served its purpose.",
};

export const survey = { ja, en };
