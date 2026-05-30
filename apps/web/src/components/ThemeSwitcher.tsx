import { useState } from "react";
import {
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
} from "@mui/material";
import PaletteIcon from "@mui/icons-material/Palette";
import CheckIcon from "@mui/icons-material/Check";
import { THEME_LIST, THEMES } from "../theme/themes.js";
import { useThemeSettings } from "../theme/ThemeContext.js";

export function ThemeSwitcher() {
  const { themeKey, setThemeKey, fireworksOn, setFireworksOn } =
    useThemeSettings();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const hasFireworks = Boolean(THEMES[themeKey]?.fireworks);

  return (
    <>
      <Tooltip title="テーマ">
        <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)}>
          <PaletteIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {THEME_LIST.map((t) => (
          <MenuItem
            key={t.key}
            selected={t.key === themeKey}
            onClick={() => {
              setThemeKey(t.key);
              setAnchor(null);
            }}
          >
            <ListItemText>{t.label}</ListItemText>
            {t.key === themeKey && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          disabled={!hasFireworks}
          onClick={() => setFireworksOn(!fireworksOn)}
        >
          <ListItemText
            secondary={!hasFireworks ? "このテーマは花火なし" : undefined}
          >
            背景の花火
          </ListItemText>
          <Switch edge="end" checked={fireworksOn && hasFireworks} />
        </MenuItem>
      </Menu>
    </>
  );
}
