import { useEffect, useRef } from "react";
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  BottomNavigation, BottomNavigationAction, Paper, useMediaQuery, useTheme,
} from "@mui/material";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import { Tab, RouteHandle, tabs } from "./tabs";

const SIDEBAR_WIDTH = 240;

export default function AppLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const location = useLocation();
  const navigate = useNavigate();
  const matches = useMatches();

  // Any matched route can opt out with handle: { hideNav: true }
  const navHidden = matches.some((m) => (m.handle as RouteHandle | undefined)?.hideNav);

  const activeTab = tabs.find(
    (t) => location.pathname === `/${t.id}` || location.pathname.startsWith(`/${t.id}/`)
  );

  // Remember where each tab was, so switching back restores its stack position
  const lastPath = useRef<Record<string, string>>({});
  useEffect(() => {
    if (activeTab && !navHidden) {
      lastPath.current[activeTab.id] = location.pathname + location.search;
    }
  }, [activeTab, navHidden, location]);

  const goTo = (tab: Tab) => {
    if (tab.id === activeTab?.id) navigate(`/${tab.id}`);            // tap active tab: back to its root
    else navigate(lastPath.current[tab.id] ?? `/${tab.id}`);         // else: resume where it was
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        height: "100dvh",
        pt: isMobile ? "env(safe-area-inset-top)" : 0,
        pb: isMobile && navHidden ? "env(safe-area-inset-bottom)" : 0,
      }}
    >
      {!isMobile && !navHidden && (
        <Drawer
          variant="permanent"
          sx={{ width: SIDEBAR_WIDTH, "& .MuiDrawer-paper": { width: SIDEBAR_WIDTH } }}
        >
          <List>
            {tabs.map((t) => (
              <ListItemButton key={t.id} selected={t.id === activeTab?.id} onClick={() => goTo(t)}>
                <ListItemIcon>{t.icon}</ListItemIcon>
                <ListItemText primary={t.label} />
              </ListItemButton>
            ))}
          </List>
        </Drawer>
      )}

      <Box component="main" sx={{ flex: 1, overflowY: "auto" }}>
        <Outlet />
      </Box>

      {isMobile && !navHidden && (
        <Paper elevation={3} sx={{ pb: "env(safe-area-inset-bottom)" }}>
          <BottomNavigation
            showLabels
            value={activeTab?.id ?? false}
            onChange={(_, id) => goTo(tabs.find((t) => t.id === id)!)}
          >
            {tabs.map((t) => (
              <BottomNavigationAction key={t.id} value={t.id} label={t.label} icon={t.icon} />
            ))}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}
