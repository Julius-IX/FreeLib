import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, IconButton, Paper, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate, useOutletContext } from "react-router-dom";
import { readFile } from "@tauri-apps/plugin-fs";

/** Route segment of the mobile preview page, nested under add-book. */
export const COVER_SEGMENT = "cover";

/** What NewBook hands to its nested route (mobile) through <Outlet context>. */
export type CoverCtx = { cover: string; setCover: (v: string) => void };

const isLink = (s: string) => /^https?:\/\//i.test(s);

function validLink(s: string): string | null {
  try {
    new URL(s);
    return s;
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Local file -> blob URL. The asset:// protocol can't be used: WebKitGTK refuses to load it
 * from the http dev origin, and on Android the picker returns content:// URIs it can't serve.
 */
export function useLocalImage(path: string | null) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });

  useEffect(() => {
    setState({ url: null, failed: false });
    if (!path) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    readFile(path)
      .then((bytes) => {
        if (cancelled) return;
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? "" }));
        setState({ url: objectUrl, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value); // starts at `value`, so first render isn't delayed
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Loader({ url }: { url: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 120 }}>
      {state === "loading" && <CircularProgress size={28} />}
      {state === "error" && (
        <Typography variant="body2" color="error" align="center">
          Couldn't load this image
        </Typography>
      )}
      <Box
        component="img"
        src={url}
        alt="Cover preview"
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        sx={{
          display: state === "loaded" ? "block" : "none",
          maxWidth: "100%",
          maxHeight: "65vh",
          objectFit: "contain",
          borderRadius: 1,
        }}
      />
    </Box>
  );
}

/** Renders a cover from a link or local path. Debounced so half-typed URLs don't fire requests. */
export function CoverImage({ source }: { source: string }) {
  const s = useDebounced(source.trim(), 400);
  const link = isLink(s) ? validLink(s) : null;
  const local = useLocalImage(s && !isLink(s) ? s : null);
  const url = link ?? local.url;

  if (!s) {
    return (
      <Typography variant="body2" color="text.secondary" align="center">
        No cover selected
      </Typography>
    );
  }
  if (local.failed || (isLink(s) && !link)) {
    return (
      <Typography variant="body2" color="error" align="center">
        Couldn't load this image
      </Typography>
    );
  }
  if (!url) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", minHeight: 120, alignItems: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  return <Loader key={url} url={url} />; // key: reset loading/error state per image
}

/** Desktop: floats to the right of the base modal. Position it inside a `position: relative` parent. */
export function CoverPreviewCard({ source }: { source: string }) {
  return (
    <Paper
      elevation={24}
      sx={{
        position: "absolute",
        top: 0,
        left: "calc(100% + 16px)",
        width: "clamp(140px, calc((100vw - 600px) / 2 - 32px), 300px)",
        p: 1.5,
        boxSizing: "border-box",
      }}
    >
      <Typography variant="overline" color="text.secondary">
        Cover preview
      </Typography>
      <CoverImage source={source} />
    </Paper>
  );
}

/** Mobile: dedicated page, route `add-book/cover`. */
export default function CoverPreviewPage() {
  const navigate = useNavigate();
  const { cover, setCover } = useOutletContext<CoverCtx>();

  return (
    <Box sx={{ p: 2, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <IconButton aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
      </Box>

      <CoverImage source={cover} />

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        <Button
          onClick={() => {
            setCover("");
            navigate(-1);
          }}
        >
          Remove
        </Button>
        <Button variant="contained" onClick={() => navigate(-1)}>
          Use this cover
        </Button>
      </Box>
    </Box>
  );
}
