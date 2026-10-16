import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@emotion/react";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import type { Rect } from "./geometry";

const pop = keyframes`
  0% { transform: scale(0.4); opacity: 0; }
  70% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const MOVE = "420ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const CORNER = 28;
const corner = (v: "top" | "bottom", h: "left" | "right") => ({
  position: "absolute" as const,
  [v]: -2,
  [h]: -2,
  width: CORNER,
  height: CORNER,
  borderStyle: "solid",
  borderColor: "inherit",
  borderWidth: 0,
  [`border${v === "top" ? "Top" : "Bottom"}Width`]: 4,
  [`border${h === "left" ? "Left" : "Right"}Width`]: 4,
  [`border${v === "top" ? "Top" : "Bottom"}${h === "left" ? "Left" : "Right"}Radius`]: 12,
});

/**
 * Nothing is drawn while looking. When a code is read (`locked`) a frame fades in at the centre,
 * flies to `target` (where the code is in the picture), dims everything else and turns green
 * with a check. Fills its (positioned) parent, which must be the same box as the camera canvas.
 */
export function ScanOverlay({ locked, target }: { locked: boolean; target: Rect | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [arrived, setArrived] = useState(false); // false = still at the centre, true = flying/flown

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Two frames: first paint the frame at the centre, then change its rect so it transitions.
  useEffect(() => {
    if (!locked) return setArrived(false);
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [locked]);

  const w = Math.min(size.w * 0.6, size.h * 0.6, 260); // square, until it moves to the code
  const h = w;
  const home: Rect = { left: (size.w - w) / 2, top: (size.h - h) / 2, width: w, height: h };
  const rect = arrived && target ? target : home;
  const green = arrived;

  return (
    <Box ref={ref} sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <Box
        sx={{
          position: "absolute",
          ...rect,
          opacity: locked ? 1 : 0,
          borderRadius: 3,
          borderColor: green ? "success.main" : "common.white",
          boxShadow: locked && arrived ? "0 0 0 100vmax rgba(0,0,0,0.5)" : "0 0 0 100vmax rgba(0,0,0,0)",
          transition: `left ${MOVE}, top ${MOVE}, width ${MOVE}, height ${MOVE}, box-shadow 420ms, opacity 160ms, border-color 300ms ease 250ms`,
        }}
      >
        <Box sx={{ position: "absolute", inset: 0, borderColor: "inherit" }}>
          <Box sx={corner("top", "left")} />
          <Box sx={corner("top", "right")} />
          <Box sx={corner("bottom", "left")} />
          <Box sx={corner("bottom", "right")} />
        </Box>
        {arrived && (
          <CheckCircleIcon
            color="success"
            sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              mt: "-20px",
              ml: "-20px",
              fontSize: 40,
              animation: `${pop} 280ms ease-out 380ms both`,
            }}
          />
        )}
      </Box>
    </Box>
  );
}
