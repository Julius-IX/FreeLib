import { useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

/** Three lines of blurb with a toggle, shown only when there's something to expand. */
export function Blurb({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <Box>
      <Typography
        ref={ref}
        variant="body2"
        color="text.secondary"
        sx={{
          whiteSpace: "pre-line",
          ...(!expanded && {
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }),
        }}
      >
        {text}
      </Typography>
      {(overflows || expanded) && (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <IconButton size="small" aria-label={expanded ? "Show less" : "Show more"} onClick={() => setExpanded((e) => !e)}>
            <ExpandMoreIcon sx={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
