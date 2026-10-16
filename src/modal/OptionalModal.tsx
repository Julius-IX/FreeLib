import { forwardRef, ReactElement, ReactNode, Ref, useContext, useLayoutEffect } from "react";
import { Dialog, DialogProps, Slide } from "@mui/material";
import { TransitionProps } from "@mui/material/transitions";
import { useNavigate } from "react-router-dom";
import { ModalContext } from "./ModalHost";
import { setModalMounted } from "./modalMounted";

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: ReactElement },
  ref: Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export default function OptionalModal({
  children,
  slotProps,
  slots,
  sx,
  bottomSheet = false,
  ...props
}: { children: ReactNode; bottomSheet?: boolean } & Omit<DialogProps, "open" | "onClose">) {
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
      slots={{
        ...slots,
        ...(bottomSheet && { transition: SlideUp }),
      }}
      sx={[
        bottomSheet && {
          position: props.container ? "absolute" : undefined,
          "& .MuiDialog-container": { alignItems: "flex-end" },
          "& .MuiDialog-paper": {
            backgroundColor: "background.paper",
            m: 0,
            width: "100%",
            maxWidth: "none",
            maxHeight: "100%",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
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
