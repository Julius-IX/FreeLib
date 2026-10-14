import { ReactNode, useContext, useLayoutEffect } from "react";
import { Dialog, DialogProps } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ModalContext } from "@/ModalHost";
import { setModalMounted } from "@util/modalMounted";

export default function OptionalModal({
  children,
  slotProps,
  ...props
}: { children: ReactNode } & Omit<DialogProps, "open" | "onClose">) {
  const navigate = useNavigate();
  const { isModal, closing, onExited } = useContext(ModalContext);

  useLayoutEffect(() => {
    if (!isModal) return;
    setModalMounted(true);
    return () => setModalMounted(false);
  }, [isModal]);

  if (!isModal) return <>{children}</>;

  return (
    <Dialog
      {...props}
      disableScrollLock
      open={!closing}
      onClose={() => navigate(-1)}
      slotProps={{
        ...slotProps,
        backdrop: {
          ...(typeof slotProps?.backdrop === "function" ? {} : slotProps?.backdrop),
          transitionDuration: { enter: 0, exit: 200 },
        },
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
