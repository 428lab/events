import { Box, Stack, Typography } from "@mui/material";

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
        第{n}条（{title}）
      </Typography>
      <Box sx={{ color: "text.secondary", lineHeight: 1.9 }}>{children}</Box>
    </Box>
  );
}

export function TermsPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Typography variant="h4" fontWeight={700}>
        利用規約
      </Typography>
      <Typography color="text.secondary">
        本利用規約（以下「本規約」）は、四谷ラボ（以下「運営者」）が提供する events
        lab（以下「本サービス」）の利用条件を定めるものです。利用者は本規約に同意のうえ本サービスを利用するものとします。
      </Typography>

      <Section n={1} title="適用">
        本規約は、利用者と運営者との間の本サービスの利用に関わる一切に適用されます。
      </Section>

      <Section n={2} title="アカウント">
        本サービスは Discord・Google・GitHub
        による認証でログインします。利用者は自己の責任でアカウントを管理し、第三者に利用させてはなりません。アカウントの利用により生じた行為の責任は当該アカウントの利用者に帰属します。
      </Section>

      <Section n={3} title="禁止事項">
        利用者は次の行為をしてはなりません。
        <ul>
          <li>法令または公序良俗に違反する行為</li>
          <li>他者の権利（知的財産権・プライバシー・名誉等）を侵害する行為</li>
          <li>なりすまし、虚偽情報の登録、不正アクセス、本サービスの運営妨害</li>
          <li>他の利用者への迷惑行為、差別・誹謗中傷・ハラスメント</li>
          <li>運営者の許可なく本サービスを商用利用・複製・改変する行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </Section>

      <Section n={4} title="ユーザーコンテンツ">
        イベント情報・画像・採点・お問い合わせ等、利用者が登録・投稿した内容の責任は利用者が負います。運営者は、本規約に違反する、または不適切と判断した内容を、事前通知なく削除・非表示にできます。
      </Section>

      <Section n={5} title="サービスの変更・中断・終了">
        運営者は、利用者への事前通知なく、本サービスの内容の変更・追加・中断・終了を行うことがあります。本サービスはベータ版であり、可用性・継続性を保証しません。
      </Section>

      <Section n={6} title="免責">
        運営者は、本サービスに事実上または法律上の瑕疵がないことを保証しません。本サービスの利用または利用不能により利用者に生じた損害（データの消失を含む）について、運営者の故意または重過失による場合を除き、責任を負いません。
      </Section>

      <Section n={7} title="利用制限・登録抹消">
        利用者が本規約に違反した場合、運営者は事前通知なく、当該利用者の本サービスの利用制限またはアカウント削除を行うことができます。
      </Section>

      <Section n={8} title="規約の変更">
        運営者は必要と判断した場合、本規約を変更できます。重要な変更は本サービス上で告知します。変更後に本サービスを利用した場合、変更後の規約に同意したものとみなします。
      </Section>

      <Section n={9} title="準拠法・裁判管轄">
        本規約は日本法に準拠します。本サービスに関して紛争が生じた場合、運営者の所在地を管轄する裁判所を専属的合意管轄とします。
      </Section>

      <Typography variant="body2" color="text.secondary">
        制定日: 2026年6月26日
      </Typography>
    </Stack>
  );
}
