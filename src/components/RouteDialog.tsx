import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { Dialog, DialogProps } from "@mui/material";
import { useMatches, useNavigate } from "react-router-dom";
import type { RouteHandle } from "@/tabs";

const CloseContext = createContext<(() => void) | null>(null);

/**
 * Close the surrounding RouteDialog.
 * Use this instead of `navigate(-1)` for Back/Cancel buttons inside the dialog.
 * Outside a RouteDialog it falls back to a plain `navigate(-1)`.
 */
export function useCloseRouteDialog() {
  const navigate = useNavigate();
  const close = useContext(CloseContext);
  return close ?? (() => navigate(-1));
}

/**
 * Dialog for routes marked `handle: { modal: true }`. Closing pops the route.
 * The flag may be conditional (e.g. `modal: isDesktop()`): when the current route
 * is NOT a modal, the children render as a plain page (no Dialog) and closing
 * just pops the route.
 *
 * The route stays mounted until the exit transition has finished: closing only
 * flips `open` to false, and the route is popped from the transition's `onExited`.
 * (Popping immediately would unmount the dialog mid-frame and skip the animation.)
 */
export default function RouteDialog({
  children,
  slotProps,
  ...props
}: { children: ReactNode } & Omit<DialogProps, "open" | "onClose">) {
  const navigate = useNavigate();
  const isModal = useMatches().some((m) => (m.handle as RouteHandle | undefined)?.modal);
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  const popRoute = useCallback(() => navigate(-1), [navigate]);

  // Not shown as a modal on this platform: plain page, nothing to animate out
  if (!isModal) {
    return <CloseContext.Provider value={popRoute}>{children}</CloseContext.Provider>;
  }

  return (
    <CloseContext.Provider value={close}>
      <Dialog
        {...props}
        open={open}
        onClose={close}
        slotProps={{
          ...slotProps,
          transition: {
            ...(typeof slotProps?.transition === "function" ? {} : slotProps?.transition),
            onExited: (node: HTMLElement) => {
              const t = slotProps?.transition;
              if (typeof t !== "function") t?.onExited?.(node);
              navigate(-1);
            },
          },
        }}
      >
        {children}
      </Dialog>
    </CloseContext.Provider>
  );
}
