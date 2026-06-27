import {
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../api/hooks.js";
import { useCommunities } from "../api/communityHooks.js";

export function CommunitiesPage() {
  const { data: me } = useMe();
  const { data: communities, isLoading } = useCommunities();

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          コミュニティ
        </Typography>
        {me && (
          <Button
            variant="contained"
            component={RouterLink}
            to="/communities/new"
          >
            コミュニティを作る
          </Button>
        )}
      </Stack>

      {isLoading || !communities ? (
        <Typography>読み込み中…</Typography>
      ) : communities.length === 0 ? (
        <Typography color="text.secondary">
          まだコミュニティがありません。
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {communities.map((c) => (
            <Card key={c.id} variant="outlined">
              <CardActionArea component={RouterLink} to={`/c/${c.slug}`}>
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Avatar
                      src={c.iconUrl ?? undefined}
                      variant="rounded"
                      sx={{ width: 48, height: 48 }}
                    >
                      {c.name.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {c.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        @{c.slug} ・ メンバー {c.memberCount} ・ イベント{" "}
                        {c.eventCount}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
