import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText, Tooltip,
  BottomNavigation, BottomNavigationAction, Paper, useMediaQuery, useTheme,
} from "@mui/material";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Tab, RouteHandle, tabs } from "./tabs";

const SIDEBAR_MIN = 72; // icon-only rail
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_COMPACT_BELOW = 140; // under this width, labels hide
const clamp = (n: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));

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

  // Resizable sidebar (desktop), remembered across launches
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem("sidebarW"));
    return v ? clamp(v) : SIDEBAR_DEFAULT;
  });
  useEffect(() => {
    try { localStorage.setItem("sidebarW", String(sidebarW)); } catch { }
  }, [sidebarW]);
  const compact = sidebarW < SIDEBAR_COMPACT_BELOW;
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const goTo = (tab: Tab) => {
    if (tab.id !== activeId) return setActiveId(tab.id);   // switch: the tab keeps its stack
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
        <Paper
          square
          elevation={0}
          sx={{
            position: "relative", flexShrink: 0, width: sidebarW, overflow: "hidden",
            borderRight: 1, borderColor: "divider",
          }}
        >
          <List>
            {tabs.map((t) => (
              <Tooltip key={t.id} title={compact ? t.label : ""} placement="right">
                <ListItemButton
                  selected={t.id === activeId}
                  onClick={() => goTo(t)}
                  sx={{ justifyContent: compact ? "center" : "flex-start" }}
                >
                  <ListItemIcon sx={{ minWidth: compact ? 0 : 40 }}>{t.icon}</ListItemIcon>
                  {!compact && <ListItemText primary={t.label} />}
                </ListItemButton>
              </Tooltip>
            ))}
          </List>

          {/* drag handle on the right edge; double-click resets */}
          <Box
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { startX: e.clientX, startW: sidebarW };
            }}
            onPointerMove={(e) => {
              if (drag.current) setSidebarW(clamp(drag.current.startW + e.clientX - drag.current.startX));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onDoubleClick={() => setSidebarW(SIDEBAR_DEFAULT)}
            sx={{
              position: "absolute", top: 0, right: 0, bottom: 0, width: 6,
              cursor: "col-resize", touchAction: "none",
              "&:hover, &:active": { bgcolor: "primary.main", opacity: 0.4 },
            }}
          />
        </Paper>
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
