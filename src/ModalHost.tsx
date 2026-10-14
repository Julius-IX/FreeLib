import { useRef } from "react";
import { Location, Outlet, RouteObject, useLocation, useMatches, useRoutes } from "react-router-dom";
import { RouteHandle } from "./tabs";

/**
 * Root element of every tab's router.
 * Routes with `handle: { modal: true }` render on top of the last non-modal
 * page instead of replacing it, so that page stays mounted (state + scroll kept).
 */
export default function ModalHost({ routes }: { routes: RouteObject[] }) {
  const location = useLocation();
  const isModal = useMatches().some((m) => (m.handle as RouteHandle | undefined)?.modal);

  // Last location that wasn't a modal. Stays put while modals open/close/stack.
  const background = useRef<Location | null>(isModal ? null : location);
  if (!isModal) background.current = location;

  // Always rendered through useRoutes (never <Outlet/>) so the page's element tree
  // doesn't change shape when a modal opens -> no remount.
  const page = useRoutes(routes, background.current ?? undefined);

  // Modal opened as the very first entry: no page behind it, just show the modal
  if (!background.current) return <Outlet />;

  return (
    <>
      {page}
      {isModal && <Outlet />}
    </>
  );
}
