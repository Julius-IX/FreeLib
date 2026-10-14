import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Box, Button, SnackbarContent } from "@mui/material";
import { subscribe, type Item } from "./util/notify";

const DEFAULT_NOTIFY_DURATION = 1500;
const POP_IN_MS = 180; // pop in
const POP_OUT_MS = 120; // pop out
const MAX_VISIBLE = 5; // spam past this and the oldest (buried) toast is dropped

function Toast({ item, onGone }: { item: Item; onGone: (key: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [expired, setExpired] = useState(false);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  // Mount at scale(0), force the browser to register that, then flip to scale(1)
  // before the first paint, so the pop always starts from the small state.
  useLayoutEffect(() => {
    void ref.current?.offsetHeight;
    setEntered(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setExpired(true), item.duration ?? DEFAULT_NOTIFY_DURATION);
    return () => clearTimeout(t);
  }, [item.duration]);

  const visible = entered && !expired;

  // After the pop-out finishes, tell the host to unmount
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(() => onGoneRef.current(item.key), POP_OUT_MS + 40);
    return () => clearTimeout(t);
  }, [expired, item.key]);

  const action = item.action && (
    <Button
      size="small"
      color={item.severity ? "inherit" : "primary"}
      onClick={() => {
        item.action!.onClick();
        setExpired(true);
      }}
    >
      {item.action.label}
    </Button>
  );

  const surface = {
    bgcolor: "background.paper",
    color: "text.primary",
    boxShadow: 3,
  } as const;

  const ms = visible ? POP_IN_MS : POP_OUT_MS;

  return (
    <Box
      ref={ref}
      sx={{
        gridArea: "1 / 1", // every toast occupies the exact same spot
        display: "flex",
        justifyContent: "center",
        pointerEvents: visible ? "auto" : "none",
        transformOrigin: "center",
        transform: visible ? "scale(1)" : "scale(0)",
        // opacity rides along so near-zero-size frames (just border + shadow)
        // don't flash as a tiny speck
        opacity: visible ? 1 : 0,
        transition: `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`,
      }}
    >
      {item.severity ? (
        <Alert severity={item.severity} variant="outlined" action={action} sx={surface}>
          {item.message}
        </Alert>
      ) : (
        <SnackbarContent
          message={item.message}
          action={action}
          sx={{ ...surface, border: 1, borderColor: "divider" }}
        />
      )}
    </Box>
  );
}

export function SnackbarHost() {
  const [items, setItems] = useState<Item[]>([]);

  // Newest goes last, which paints on top. Older ones stay put underneath with
  // their own timers, and get revealed as the ones above them pop out.
  useEffect(
    () => subscribe((item) => setItems((prev) => [...prev, item].slice(-MAX_VISIBLE))),
    []
  );

  const handleGone = (key: number) => setItems((prev) => prev.filter((i) => i.key !== key));

  if (!items.length) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.snackbar,
        pointerEvents: "none", // empty space around the toast stays tappable
        px: 2,
        display: "grid",
        justifyItems: "center",
        alignItems: "end",
        // On mobile, sit above the bottom nav bar instead of covering it
        bottom: { xs: "calc(72px + env(safe-area-inset-bottom))", md: 24 },
      }}
    >
      {items.map((item) => (
        <Toast key={item.key} item={item} onGone={handleGone} />
      ))}
    </Box>
  );
}
