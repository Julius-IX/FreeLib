import { ReactNode, useContext } from "react";
import { Dialog, DialogProps } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ModalContext } from "@/ModalHost";

/**
 * Wrap a route's content in this and you're done.
 *
 * - Route has `handle: { modal: true }` -> content shows in a Dialog; ModalHost keeps
 *   the previous page mounted behind it.
 * - Otherwise (e.g. `modal: isDesktop()` is false) -> content renders as a plain page.
 *
 * Content just calls `navigate(-1)` to leave. ModalHost keeps the popped modal
 * rendered with `closing: true`, so the Dialog plays its exit animation and then
 * tells ModalHost to drop it. Works for Back buttons, backdrop click, Esc and the
 * Android back handler alike.
 */
export default function OptionalModal({
  children,
  slotProps,
  ...props
}: { children: ReactNode } & Omit<DialogProps, "open" | "onClose">) {
  const navigate = useNavigate();
  const { isModal, closing, onExited } = useContext(ModalContext);

  if (!isModal) return <>{children}</>;

  return (
    <Dialog
      {...props}
      open={!closing}
      onClose={() => navigate(-1)}
      slotProps={{
        ...slotProps,
        transition: {
          ...(typeof slotProps?.transition === "function" ? {} : slotProps?.transition),
          onExited: (node: HTMLElement) => {
            const t = slotProps?.transition;
            if (typeof t !== "function") t?.onExited?.(node);
            onExited();
          },
        },
      }}
    >
      {children}
    </Dialog>
  );
}
