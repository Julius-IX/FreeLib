import { ReactNode } from "react";
import { RouteObject } from "react-router-dom";
import LibraryBooks from "@mui/icons-material/LibraryBooks";
import Extension from "@mui/icons-material/Extension";
import Settings from "@mui/icons-material/Settings";
import { libraryRoutes } from "@/features/library/routes";
import { pluginsRoutes } from "@/features/plugins/routes";
import { settingsRoutes } from "@/features/settings/routes";

// Put on a route to control the bar:  handle: { hideNav: true }
// Put modal: true to render the route as an overlay on top of the previous page
export type RouteHandle = { hideNav?: boolean; modal?: boolean };

export type Tab = {
  id: string; // also the URL segment: /library, /plugins, ...
  label: string;
  icon: ReactNode;
  routes: RouteObject[]; // this tab's own screens and sub-screens
};

// To add a menu: create features/<name>/routes.tsx and add one entry here.
export const tabs: Tab[] = [
  { id: "library", label: "Library", icon: <LibraryBooks />, routes: libraryRoutes },
  { id: "plugins", label: "Plugins", icon: <Extension />, routes: pluginsRoutes },
  { id: "settings", label: "Settings", icon: <Settings />, routes: settingsRoutes },
];
