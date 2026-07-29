import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import PlaceIcon from "@mui/icons-material/Place";
import StadiumIcon from "@mui/icons-material/Stadium";
import GroupsIcon from "@mui/icons-material/Groups";
import EditIcon from "@mui/icons-material/Edit";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { VenueOwnerView } from "@eventer/shared";
import { useVenue, venueImageUrl } from "../api/venueHooks.js";
import { Markdown } from "../components/Markdown.js";
import { UserLink } from "../components/UserLink.js";
import { UseVenueButton, VenueOwnerOffers } from "../components/VenueOffers.js";
import { VenuePhotos } from "../components/VenuePhotos.js";
import { useMe } from "../api/hooks.js";

/** 会場詳細（未ログイン可）。連絡先はマッチング成立まで非公開。 */
export function VenueDetailPage() {
  const { id = "" } = useParams();
  const q = useVenue(id);
  const { data: me } = useMe();

  if (q.isLoading) return <Typography>読み込み中…</Typography>;
  if (q.isError || !q.data) {
    return <Alert severity="info">会場が見つかりませんでした。</Alert>;
  }
  const { venue, owner, isOwner } = q.data;
  const isManager = q.data.isManager ?? isOwner;
  const img = venueImageUrl(venue);
  const contact = (venue as VenueOwnerView).contact;

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      {img && (
        <Box
          sx={{
            width: "100%",
            aspectRatio: "1200 / 630",
            borderRadius: 2,
            backgroundImage: `url(${img})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      <Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography
            variant="h4"
            fontWeight={700}
            sx={{
              wordBreak: "break-word",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <StadiumIcon fontSize="medium" />
            {venue.name}
          </Typography>
          {venue.status === "closed" && <Chip label="受付停止中" />}
          {isManager && (
            <Button
              size="small"
              startIcon={<EditIcon />}
              component={RouterLink}
              to={`/venues/${venue.id}/edit`}
            >
              編集
            </Button>
          )}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <PlaceIcon sx={{ fontSize: 18, color: "text.secondary" }} />
            <Typography color="text.secondary">
              {venue.area}
              {venue.addressPublic && venue.address ? ` ${venue.address}` : ""}
            </Typography>
          </Stack>
          {venue.capacity != null && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <GroupsIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              <Typography color="text.secondary">〜{venue.capacity}人</Typography>
            </Stack>
          )}
        </Stack>
        {!venue.addressPublic && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            詳細な住所はマッチング成立後に開示されます
          </Typography>
        )}
        {owner && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              提供者:
            </Typography>
            <UserLink
              username={owner.username}
              name={owner.globalName ?? owner.username}
              avatarUrl={owner.avatarUrl}
              withAvatar
            />
          </Stack>
        )}
      </Box>

      {/* 地図（住所公開の会場のみ）。キー不要の埋め込み＋公式リンクのフォールバック */}
      {venue.addressPublic && venue.address && (
        <Box>
          <Box
            component="iframe"
            title="会場の地図"
            src={`https://maps.google.com/maps?q=${encodeURIComponent(`${venue.area} ${venue.address}`)}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer"
            sx={{
              width: "100%",
              height: 300,
              border: 0,
              borderRadius: 2,
              display: "block",
            }}
          />
          <Link
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.area} ${venue.address}`)}`}
            target="_blank"
            rel="noopener"
            variant="body2"
            sx={{ display: "inline-block", mt: 0.5 }}
          >
            Googleマップで開く
          </Link>
        </Box>
      )}

      <VenuePhotos venueId={venue.id} isOwner={isManager} />

      {venue.description && (
        <Card variant="outlined">
          <CardContent>
            <Markdown>{venue.description}</Markdown>
          </CardContent>
        </Card>
      )}

      {(venue.equipment || venue.terms) && (
        <Card variant="outlined">
          <CardContent>
            {venue.equipment && (
              <>
                <Typography variant="h6" gutterBottom>
                  設備
                </Typography>
                <Typography sx={{ whiteSpace: "pre-wrap" }}>
                  {venue.equipment}
                </Typography>
              </>
            )}
            {venue.equipment && venue.terms && <Divider sx={{ my: 2 }} />}
            {venue.terms && (
              <>
                <Typography variant="h6" gutterBottom>
                  提供条件
                </Typography>
                <Typography sx={{ whiteSpace: "pre-wrap" }}>{venue.terms}</Typography>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isManager && contact && (
        <Alert severity="info">
          連絡先（マッチング相手にのみ開示）: {contact}
        </Alert>
      )}

      {/* イベンター向け: 利用申込（オーナー以外・ログイン済み・受付中のみ） */}
      {me && !isManager && venue.status === "open" && (
        <Box>
          <UseVenueButton venueId={venue.id} />
        </Box>
      )}

      {/* オーナー向け: オファー一覧 */}
      {isManager && <VenueOwnerOffers venueId={venue.id} />}
    </Stack>
  );
}
