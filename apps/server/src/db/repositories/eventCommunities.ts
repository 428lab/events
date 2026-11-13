/**
 * 「イベントのコミュニティ」として数える組 (docs/event-cohost.md §6)。
 *
 * 主催（event.community_id）と、承認済みの共催（event_cohost.status = 'accepted'）を
 * 同じ立場で数える（オーナー決定 2026-11-13: 「共催は起点は違うけど本来立場として同じ」）。
 * 使うのは数え方だけ: 所属（プロフィール・名札・コミュニティのメンバー）、
 * コミュニティの数字（メンバー数・開催数・KPI）、トレンド。
 * 権限・閲覧資格（eventManagerSql / eventViewSql）と access_revision には使わない。
 *
 * 1行 = (event_id, community_id)。同じ組は1行だけ（主催が共催にも入っている行は落とす）。
 * 承認待ちの共催は入らない。保存した写しは無いので、共催の承認・取り下げはその場で効く。
 *
 * 索引: 主催側は idx_event_community / idx_event_community_visibility_status、
 * 共催側は event_cohost の主キー (event_id, community_id) と
 * idx_event_cohost_community (community_id, status) で引ける。
 * コミュニティで絞るときは `eventIdsOfCommunitySql` を IN で使う（相関 EXISTS にすると
 * OR の片側で索引が使えず event を全件読む。events.ts の共催一覧と同じ理由）。
 */
export const EVENT_COMMUNITY_LINKS = `SELECT ecl_host.id AS event_id, ecl_host.community_id AS community_id
    FROM event ecl_host WHERE ecl_host.community_id IS NOT NULL
  UNION ALL
  SELECT ecl_co.event_id, ecl_co.community_id
    FROM event_cohost ecl_co
   WHERE ecl_co.status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM event ecl_dup
                      WHERE ecl_dup.id = ecl_co.event_id AND ecl_dup.community_id = ecl_co.community_id)`;

/** コミュニティ `community`（`?` か列）として数えるイベントの id。`e.id IN (…)` で使う */
export const eventIdsOfCommunitySql = (community: string) =>
  `SELECT ecl.event_id FROM (${EVENT_COMMUNITY_LINKS}) ecl WHERE ecl.community_id = ${community}`;

/** イベント `e` がコミュニティ `community` のイベントとして数えられるか */
export const eventOfCommunitySql = (e: string, community: string) =>
  `${e}.id IN (${eventIdsOfCommunitySql(community)})`;
