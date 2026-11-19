/**
 * 保存される既定の文言 (#364)。
 *
 * **作る人の言語で書いて、そのまま保存する**（オーナー決定 2026-08-13「画像は作った人の
 * 言語で焼く」を、ほかの保存データにも当てはめた。2026-11-19）。保存したあとは利用者の
 * データなので、見る人の言語に訳し直さない。
 *
 * 対象: 配信セットの既定のシーン・テンプレートの文言・置いたばかりの文字、スライドの
 * 置いたばかりの文字、シーンと複製の名前、既定の採点項目、タイムテーブルとアンケートの
 * テンプレートの中身、イベントの複製の題名。組み立ては `packages/shared/src/savedDefaults.ts`。
 *
 * **日本語は以前コードに直書きしていた文言そのまま**（既存のデータ・テストと1文字も変えない）。
 */
const ja = {
  /* ── 配信セット ─────────────────────────────── */
  /** 名前を付けずに作った配信セット */
  liveSetName: "配信セット",
  /** 配信セットを選んでいないときに使うビルトインの既定セットの名前 */
  liveSetDefaultName: "デフォルト",
  /** ビルトインの既定セットのシーン名と、投影に大写しになる本文 */
  sceneWait: "開始前待機",
  sceneOp: "OP",
  sceneDeck: "スライド全画面",
  sceneDeckCamera: "スライド + カメラ",
  sceneCamera: "カメラ全画面",
  sceneBreak: "休憩中",
  sceneEd: "ED",
  waitMessage: "まもなく開始します",
  breakMessage: "しばらくお待ちください",
  edMessage: "ご視聴ありがとうございました！",
  /** デザインテンプレート（灯り・輪郭・白磁）のシーン名と文言 */
  visualSceneOpening: "オープニング",
  visualSceneKeynote: "講演",
  visualSceneDeck: "全画面資料",
  visualSceneCamera: "全画面カメラ",
  visualSceneEnding: "エンディング",
  visualDateLabel: "イベント日時",
  visualThanks: "ご視聴ありがとうございました",
  visualThanksShort: "ありがとうございました",
  visualStartingSoon: "まもなく開始",
  visualDeckLabel: "資料",
  /** デザイン部品（氏名帯・章カードなど）を置いたときの仮の文字 */
  partNamePlaceholder: "氏名を入力",
  partRolePlaceholder: "役割を入力",
  partChapterKind: "章タイトル",
  partTitlePlaceholder: "タイトルを入力",
  partChapterTitlePlaceholder: "章タイトルを入力",

  /* ── 編集で作るもの（配信セット・スライド） ─────────── */
  sceneName: "シーン {{n}}",
  /** シーン・配信セットの複製の名前 */
  copyName: "{{name}}のコピー",
  /** 置いたばかりのテキスト */
  text: "テキスト",

  /* ── イベント ───────────────────────────────── */
  /** イベントの複製の題名 */
  eventCopyTitle: "{{title}}のコピー",
  /** 既定の採点項目 */
  criterionTechnical: "技術力",
  criterionTechnicalDesc: "実装の難易度・完成度",
  criterionOriginality: "独自性",
  criterionOriginalityDesc: "アイデアの新規性",
  criterionCompleteness: "完成度",
  criterionCompletenessDesc: "動作・仕上がり",
  criterionPresentation: "プレゼン",
  criterionPresentationDesc: "発表のわかりやすさ",

  /* ── タイムテーブルのテンプレート（コマの題名・説明） ──── */
  scheduleDoors: "開場・受付",
  scheduleOpening: "オープニング",
  scheduleOpeningDesc: "趣旨説明・諸注意",
  scheduleOpeningRulesDesc: "趣旨説明・ルール説明",
  scheduleLt: "LT {{n}}",
  scheduleLtDesc: "発表5分＋入れ替え",
  scheduleBreak: "休憩",
  scheduleSession: "セッション {{n}}",
  scheduleQa: "質疑応答・ディスカッション",
  scheduleIdeation: "アイデア出し・チームビルディング",
  scheduleHacking: "開発タイム",
  scheduleDemos: "成果発表",
  scheduleJudging: "審査・表彰",
  scheduleParty: "懇親会",
  scheduleTeardown: "撤収",
  scheduleClosing: "クロージング",

  /* ── アンケートのテンプレート（質問文・選択肢） ───────── */
  surveyName: "氏名",
  surveyAffiliation: "所属・会社名",
  surveyPartyJoin: "懇親会に参加しますか",
  surveyPartyYes: "参加",
  surveyPartyNo: "不参加",
  surveyDiet: "食物アレルギー・食事制限",
  surveyOccupation: "属性・職種",
  surveyOccupationEngineer: "エンジニア",
  surveyOccupationDesigner: "デザイナー",
  surveyOccupationPm: "プロダクトマネージャー",
  surveyOccupationFounder: "経営・アントレプレナー",
  surveyOccupationStudent: "学生",
  surveyOccupationOther: "その他",
  surveyLevel: "このテーマの知識レベル",
  surveyLevelNew: "初めて",
  surveyLevelBeginner: "入門レベル",
  surveyLevelPractitioner: "実務経験あり",
  surveyLevelExpert: "専門・エキスパート",
  surveyInterests: "興味のある分野（複数選択可）",
  surveyInterestAi: "AI・機械学習",
  surveyInterestWeb: "Web開発",
  surveyInterestMobile: "モバイル",
  surveyInterestInfra: "インフラ・クラウド",
  surveyInterestDesign: "デザイン・UX",
  surveyInterestBusiness: "ビジネス・起業",
};

/** 選択肢は「, 」で区切って編集欄に入るので、英語にも読点（,）を入れないこと */
const en: Record<keyof typeof ja, string> = {
  liveSetName: "Broadcast set",
  liveSetDefaultName: "Default",
  sceneWait: "Waiting to start",
  sceneOp: "Opening",
  sceneDeck: "Full-screen slides",
  sceneDeckCamera: "Slides + camera",
  sceneCamera: "Full-screen camera",
  sceneBreak: "On break",
  sceneEd: "Ending",
  waitMessage: "Starting soon",
  breakMessage: "Please wait a moment",
  edMessage: "Thank you for watching!",
  visualSceneOpening: "Opening",
  visualSceneKeynote: "Talk",
  visualSceneDeck: "Full-screen slides",
  visualSceneCamera: "Full-screen camera",
  visualSceneEnding: "Ending",
  visualDateLabel: "Event date",
  visualThanks: "Thank you for watching",
  visualThanksShort: "Thank you",
  visualStartingSoon: "Starting soon",
  visualDeckLabel: "Slides",
  partNamePlaceholder: "Enter a name",
  partRolePlaceholder: "Enter a role",
  partChapterKind: "Chapter",
  partTitlePlaceholder: "Enter a title",
  partChapterTitlePlaceholder: "Enter a chapter title",

  sceneName: "Scene {{n}}",
  copyName: "Copy of {{name}}",
  text: "Text",

  eventCopyTitle: "Copy of {{title}}",
  criterionTechnical: "Technical skill",
  criterionTechnicalDesc: "Difficulty and quality of the build",
  criterionOriginality: "Originality",
  criterionOriginalityDesc: "Novelty of the idea",
  criterionCompleteness: "Completeness",
  criterionCompletenessDesc: "How well it works and how finished it is",
  criterionPresentation: "Presentation",
  criterionPresentationDesc: "Clarity of the talk",

  scheduleDoors: "Doors open and check-in",
  scheduleOpening: "Opening",
  scheduleOpeningDesc: "Purpose and house rules",
  scheduleOpeningRulesDesc: "Purpose and rules",
  scheduleLt: "LT {{n}}",
  scheduleLtDesc: "5-minute talk + changeover",
  scheduleBreak: "Break",
  scheduleSession: "Session {{n}}",
  scheduleQa: "Q&A and discussion",
  scheduleIdeation: "Ideas and team building",
  scheduleHacking: "Hacking time",
  scheduleDemos: "Demos",
  scheduleJudging: "Judging and awards",
  scheduleParty: "Networking party",
  scheduleTeardown: "Teardown",
  scheduleClosing: "Closing",

  surveyName: "Full name",
  surveyAffiliation: "Affiliation / company",
  surveyPartyJoin: "Will you join the networking party?",
  surveyPartyYes: "Yes",
  surveyPartyNo: "No",
  surveyDiet: "Food allergies / dietary restrictions",
  surveyOccupation: "Role / occupation",
  surveyOccupationEngineer: "Engineer",
  surveyOccupationDesigner: "Designer",
  surveyOccupationPm: "Product manager",
  surveyOccupationFounder: "Executive / founder",
  surveyOccupationStudent: "Student",
  surveyOccupationOther: "Other",
  surveyLevel: "Your knowledge of this topic",
  surveyLevelNew: "New to it",
  surveyLevelBeginner: "Beginner",
  surveyLevelPractitioner: "Hands-on experience",
  surveyLevelExpert: "Expert",
  surveyInterests: "Areas of interest (choose any)",
  surveyInterestAi: "AI / machine learning",
  surveyInterestWeb: "Web development",
  surveyInterestMobile: "Mobile",
  surveyInterestInfra: "Infrastructure / cloud",
  surveyInterestDesign: "Design / UX",
  surveyInterestBusiness: "Business / startups",
};

export const savedDefaults = { ja, en };
