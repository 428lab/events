import { Box, Link, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { ACCOUNT_DELETION_GRACE_DAYS } from "@eventer/shared";

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {n}. {title}
      </Typography>
      <Box sx={{ color: "text.secondary", lineHeight: 1.9 }}>{children}</Box>
    </Box>
  );
}

export function PrivacyPolicyPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Typography variant="h4" fontWeight={700}>
        プライバシーポリシー
      </Typography>
      <Typography color="text.secondary">
        events lab（以下「本サービス」）は、利用者の個人情報を以下のとおり取り扱います。
      </Typography>

      <Section n={1} title="運営者">
        名称: 四谷ラボ
        <br />
        連絡先: 本サービス内の
        <Link component={RouterLink} to="/inquiries" sx={{ mx: 0.5 }}>
          お問い合わせフォーム
        </Link>
        （ログイン後にご利用いただけます）
      </Section>

      <Section n={2} title="取得する情報">
        <strong>(1) ログイン連携情報</strong> — Discord・Google・GitHub・X（Twitter）・Nostr
        でログインする際、各サービスから取得します。
        <ul>
          <li>各サービスのユーザーID（Nostr は公開鍵）、ユーザー名／表示名、アイコン画像のURL</li>
          <li>メールアドレス（アカウント統合・連絡のために取得する場合があります。X・Nostr からは取得しません）</li>
          <li>パスワードは取得しません（認証は各サービスに委ねます）</li>
          <li>
            Nostr のプロフィール（表示名・アイコン）は、ブラウザから公開リレーに照会して取得します（照会するのは公開鍵のみです）
          </li>
        </ul>
        <strong>(2) 利用に伴い作成される情報</strong> —
        作成・参加したイベント、参加状態、ロール、採点内容、表彰結果、成果物URL、アップロード／生成した画像、フォロー関係、お問い合わせ内容。会場を登録する場合は会場情報（詳細住所・連絡先を含む。
        <strong>詳細住所（非公開設定時）と連絡先はマッチングが成立した相手にのみ開示され、それ以外には公開されません</strong>）。
        <br />
        <strong>(3) 技術的情報</strong> —
        ログイン保持のためのCookie（セッション）、アクセス統計のための訪問者Cookie（ランダムなIDのみ。統計は参照元・国単位の日次集計で、生のIPアドレスは統計として保存しません）、アクセスに伴う通信ログ（IPアドレス等）。サイトの利用状況を把握するため、閲覧されたページ、参照元、大まかな地域、端末の種類などを集計します。この集計にクッキーは使用せず、個人を特定できる形では記録しません。
      </Section>

      <Section n={3} title="利用目的">
        本サービスの提供・認証・表示・運営、不正利用の防止、品質改善、お問い合わせ対応のために利用します。
      </Section>

      <Section n={4} title="公開される情報（重要）">
        公開イベントでは、参加者の表示名・アイコン・参加状況・採点集計・受賞結果などが、他の参加者や未ログインの第三者にも表示されます。公開を望まない情報は登録しないでください。「非公開」イベントはメンバーおよび運営管理者のみが閲覧できます。
      </Section>

      <Section n={5} title="第三者提供・委託">
        法令に基づく場合を除き、本人の同意なく第三者へ提供しません。インフラとして
        Cloudflare（保存・配信）、認証のために Discord・Google・GitHub・X（Twitter）
        を利用し、これらの事業者のサーバー（国外を含む）にデータが保存されることがあります。
      </Section>

      <Section n={6} title="データの保管・セキュリティ">
        データは Cloudflare 上に保存し、通信は HTTPS
        で暗号化します。利用目的に必要な範囲で適切に管理します。
      </Section>

      <Section n={7} title="退会・データの削除">
        参加解除やイベント削除（主催者）で関連データを削除できます。アカウント設定から退会でき、退会すると
        <strong>ただちにアカウントを利用できなくなり、プロフィール・参加者一覧・チャットの表示など他の利用者から見える場所には表示されなくなります</strong>
        。
        <br />
        誤操作の救済とトラブル対応時の本人確認のため、実データの削除には
        <strong>{ACCOUNT_DELETION_GRACE_DAYS}日間の猶予期間</strong>
        を設けています。この期間内に同じログイン方法でログインすると、確認のうえ復帰できます。猶予期間中のデータは復帰のためだけに保持し、本サービス上での表示・利用には用いません。
        <br />
        猶予期間の経過後は自動的に完全削除され、参加履歴・いいね・コメント・アップロードした画像・ログイン情報は削除されます（主催したイベント・コミュニティ・会場は、参加者の記録を保つため「退会済みユーザー」名義で残ります）。完全削除の後は復元できません。保有データの開示・訂正・削除をご希望の場合は、お問い合わせフォームよりご連絡ください。
      </Section>

      <Section n={8} title="運用記録（監査ログ）">
        アカウントの統合・退会（申請・復帰・完全削除）・ログイン方法の引き継ぎなど、後から取り消せない操作については、不正利用や不具合の調査のためユーザーIDとユーザー名（ハンドル）・操作日時を記録し、1年間保持したのち自動的に削除します。メールアドレス・連絡先・投稿本文は記録しません。
      </Section>

      <Section n={9} title="Cookie">
        ログイン保持のCookieと、イベントのアクセス統計（日次のユニーク訪問者数の集計）のためのCookieを使用します。ログイン用Cookieを無効化するとログインできません。広告目的・第三者へのトラッキング目的のCookieは使用しません。
      </Section>

      <Section n={10} title="ベータ版について">
        本サービスはベータ版であり、機能・仕様は予告なく変更・停止されることがあります。データ保全に努めますが、完全性・可用性を保証するものではありません。
      </Section>

      <Section n={11} title="改定">
        本ポリシーは必要に応じて改定し、重要な変更は本サービス上で告知します。
      </Section>

      <Typography variant="body2" color="text.secondary">
        制定日: 2026年6月26日 ・ 最終更新日: 2026年8月9日
      </Typography>
    </Stack>
  );
}
