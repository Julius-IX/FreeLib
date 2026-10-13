import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, BottomNavigation, BottomNavigationAction, Paper, useMediaQuery, useTheme,
} from "@mui/material";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Tab, RouteHandle, tabs } from "./tabs";

const SIDEBAR_WIDTH = 240;

type TabRouter = ReturnType<typeof createMemoryRouter>;

// Every tab gets its OWN router (its own history stack), independent of the others
const makeRouter = (t: Tab) => createMemoryRouter(t.routes, { initialEntries: ["/"] });

const atRoot = (r: TabRouter) => r.state.location.key === "default";

function useNavHidden(router: TabRouter) {
  return useSyncExternalStore(
    (cb) => router.subscribe(cb),
    () => router.state.matches.some((m) => (m.route.handle as RouteHandle | undefined)?.hideNav)
  );
}

export default function AppLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [activeId, setActiveId] = useState(tabs[0].id);
  const [stacks, setStacks] = useState(() =>
    Object.fromEntries(tabs.map((t) => [t.id, { router: makeRouter(t), gen: 0 }]))
  );

  const navHidden = useNavHidden(stacks[activeId].router);

  const goTo = (tab: Tab) => {
    if (tab.id !== activeId) return setActiveId(tab.id); // switch: the tab keeps its stack
    // tapping the active tab: reset it to its root
    stacks[tab.id].router.dispose();
    setStacks((s) => ({ ...s, [tab.id]: { router: makeRouter(tab), gen: s[tab.id].gen + 1 } }));
  };

  // Android hardware back: pop the active tab's stack, then go to the first tab, then exit
  const latest = useRef({ activeId, stacks });
  latest.current = { activeId, stacks };
  useEffect(() => {
    history.pushState({ sentinel: true }, "");
    const onPop = () => {
      const { activeId, stacks } = latest.current;
      const router = stacks[activeId].router;
      if (!atRoot(router)) {
        history.pushState({ sentinel: true }, "");
        router.navigate(-1);
      } else if (activeId !== tabs[0].id) {
        history.pushState({ sentinel: true }, "");
        setActiveId(tabs[0].id);
      } // else: let the OS close the app
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
              <ListItemButton key={t.id} selected={t.id === activeId} onClick={() => goTo(t)}>
                <ListItemIcon>{t.icon}</ListItemIcon>
                <ListItemText primary={t.label} />
              </ListItemButton>
            ))}
          </List>
        </Drawer>
      )}

      <Box component="main" sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((t) => (
          <Box
            key={`${t.id}-${stacks[t.id].gen}`}
            sx={{ display: t.id === activeId ? "block" : "none", height: "100%", overflowY: "auto" }}
          >
            <RouterProvider router={stacks[t.id].router} />
          </Box>
        ))}
      </Box>

      {isMobile && !navHidden && (
        <Paper elevation={3} sx={{ pb: "env(safe-area-inset-bottom)" }}>
          <BottomNavigation
            showLabels
            value={activeId}
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
