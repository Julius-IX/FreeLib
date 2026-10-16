import { ReactNode } from "react";
import { RouteObject } from "react-router-dom";
import LibraryBooks from "@mui/icons-material/LibraryBooks";
import Explore from "@mui/icons-material/Explore";
import Settings from "@mui/icons-material/Settings";
import { libraryRoutes } from "@/features/library/routes";
import { browseRoutes } from "@/features/browse/routes";
import { settingsRoutes } from "@/features/settings/routes";

// Put on a route to control the bar:  handle: { hideNav: true }
// Put modal: true to render the route as an overlay on top of the previous page
export type RouteHandle = { hideNav?: boolean; modal?: boolean };

export type Tab = {
  id: string; // also the URL segment: /library, /browse, ...
  label: string;
  icon: ReactNode;
  routes: RouteObject[]; // this tab's own screens and sub-screens
};

// To add a menu: create features/<name>/routes.tsx and add one entry here.
export const tabs: Tab[] = [
  { id: "library", label: "Library", icon: <LibraryBooks />, routes: libraryRoutes },
  { id: "browse", label: "Browse", icon: <Explore />, routes: browseRoutes },
  { id: "settings", label: "Settings", icon: <Settings />, routes: settingsRoutes },
];
