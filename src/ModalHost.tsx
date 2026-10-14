import { createContext, useCallback, useMemo, useReducer, useRef } from "react";
import type { Location, RouteObject } from "react-router-dom";
import { useLocation, useMatches, useRoutes } from "react-router-dom";
import type { RouteHandle } from "./tabs";

export type ModalState = {
  /** This route is being shown as a modal (vs. a plain page). */
  isModal: boolean;
  /** The route was popped; keep rendering it just long enough to play the exit animation. */
  closing: boolean;
  /** The modal finished its exit animation, ModalHost can drop it now. */
  onExited: () => void;
};

export const ModalContext = createContext<ModalState>({
  isModal: false,
  closing: false,
  onExited: () => { },
});

// Render a set of routes as if the router were sitting at `location`.
const RoutesAt = ({ routes, location }: { routes: RouteObject[]; location: Location }) =>
  useRoutes(routes, location);

/**
 * Root element of every tab's router.
 *
 * Two slots, both rendered through useRoutes (never <Outlet/>) so their element trees
 * never change shape and nothing remounts when a modal opens or closes:
 *
 *   page  - the last NON-modal location. Stays put while modals open/close, so its
 *           state and scroll position survive.
 *   modal - the latest modal location.
 *
 * A route is a modal when it has `handle: { modal: true }`. Modal routes must put
 * <OptionalModal> at their root, that's what reads ModalContext and calls onExited.
 */
export default function ModalHost({ routes }: { routes: RouteObject[] }) {
  const location = useLocation();
  const isModal = useMatches().some((m) => (m.handle as RouteHandle | undefined)?.modal);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const page = useRef<Location | null>(null);
  if (!isModal) page.current = location;

  const modal = useRef<Location | null>(null);
  if (isModal) modal.current = location;

  const isModalRef = useRef(isModal);
  isModalRef.current = isModal;

  const onExited = useCallback(() => {
    if (isModalRef.current) return; // re-opened mid-animation, keep it
    modal.current = null;
    rerender();
  }, []);

  const closing = !isModal;
  const modalState = useMemo(() => ({ isModal: true, closing, onExited }), [closing, onExited]);

  return (
    <>
      {page.current && <RoutesAt routes={routes} location={page.current} />}
      {modal.current && (
        <ModalContext.Provider value={modalState}>
          <RoutesAt routes={routes} location={modal.current} />
        </ModalContext.Provider>
      )}
    </>
  );
}
