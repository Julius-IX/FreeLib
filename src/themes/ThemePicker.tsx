import { Select, MenuItem, ToggleButtonGroup, ToggleButton } from "@mui/material";
import { useAppTheme } from "./AppThemeProvider";
import { themeNames, themeLabel, ThemeName } from "./themes";

export function ThemePicker() {
  const { name, setName, mode, setMode } = useAppTheme();
  return (
    <>
      <Select value={name} onChange={(e) => setName(e.target.value as ThemeName)}>
        {themeNames.map((n) => (
          <MenuItem key={n} value={n}>{themeLabel(n)}</MenuItem>
        ))}
      </Select>
      <ToggleButtonGroup exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
        <ToggleButton value="light">Light</ToggleButton>
        <ToggleButton value="dark">Dark</ToggleButton>
        <ToggleButton value="system">System</ToggleButton>
      </ToggleButtonGroup>
    </>
  );
}
