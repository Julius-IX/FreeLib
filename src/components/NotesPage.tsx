import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, CircularProgress, IconButton, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { notify } from "@/notifications/notify";
import { NotesEditor } from "./NotesEditor";

// Desktop only: the modal never shrinks below this, however small the window gets.
const MODAL_MIN_WIDTH = 360;
const MODAL_MIN_HEIGHT = 360;
const SAVE_DELAY_MS = 600;

type Props = {
  /** Heading of the page, e.g. "Notes". */
  title: string;
  /** Smaller line under the heading: what these notes belong to. */
  subtitle?: string;
  /** What to say when the text can't be loaded (or there is nothing to load it for). */
  loadFailedText: string;
  /** Reads the saved text. `null` means there's nothing to load: shown as a load failure. */
  load: (() => Promise<string>) | null;
  /** Writes the text. Called a moment after typing stops, and when the page is left. */
  save: (text: string) => Promise<void>;
  /** Name of the thing being saved, for messages: "Couldn't save <what>". */
  what: string;
  /**
   * Checks the text before it's saved. Return a message to hold the save back (shown under the
   * text), or `null` if it's fine. Text that fails is never saved.
   */
  validate?: (text: string) => string | null;
  /** Something to show under the heading (an Alert, a hint). */
  notice?: ReactNode;
  /** Text area only, monospace, no markdown. See `NotesEditor`. */
  plain?: boolean;
  placeholder?: string;
};

/**
 * One screen for writing a piece of text that saves as you type, no edit/save buttons.
 * Mobile: a full screen page. Desktop: a modal. Used for a book's notes and for a plugin's config;
 * the caller says where the text comes from and goes to.
 */
export default function NotesPage({
  title,
  subtitle,
  loadFailedText,
  load,
  save,
  what,
  validate,
  notice,
  plain = false,
  placeholder,
}: Props) {
  const navigate = useNavigate();
  const mobile = isMobile();

  const [text, setText] = useState<string | null>(null); // null = still loading
  const [loadFailed, setLoadFailed] = useState(load === null);
  const [problem, setProblem] = useState<string | null>(null); // why the current text isn't being saved

  useEffect(() => {
    if (!load) return;
    let stale = false;
    load()
      .then((v) => !stale && setText(v))
      .catch((e) => {
        if (stale) return;
        setLoadFailed(true);
        notify(`Couldn't load ${what}: ${String(e)}`, { severity: "error" });
      });
    return () => {
      stale = true;
    };
  }, [load, what]);

  // Debounced autosave. `pending` holds what still needs writing; flush() writes it now.
  const pending = useRef<{ text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const heldBack = useRef<string | null>(null); // the validate() message for text that was NOT saved
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveRef.current(p.text).catch((e) => notify(`Couldn't save ${what}: ${String(e)}`, { severity: "error" }));
  }, [what]);

  const onChange = (value: string) => {
    setText(value);
    window.clearTimeout(timer.current);
    const message = validate?.(value) ?? null;
    heldBack.current = message;
    setProblem(message);
    if (message) {
      pending.current = null; // never write text that failed the check
      return;
    }
    pending.current = { text: value };
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  // leaving the screen writes whatever is still pending, and says so if it had to drop some
  useEffect(
    () => () => {
      flush();
      if (heldBack.current) notify(`Changes to the ${what} weren't saved: ${heldBack.current}`, { severity: "warning" });
    },
    [flush, what]
  );

  return (
    <OptionalModal
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { height: "70vh", minWidth: MODAL_MIN_WIDTH, minHeight: MODAL_MIN_HEIGHT } } }}
    >
      <Box sx={{ height: "100%", minHeight: 0, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            p: 0.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <IconButton aria-label={mobile ? "Back" : "Close"} onClick={() => navigate(-1)}>
            {mobile ? <ArrowBackIcon /> : <CloseIcon />}
          </IconButton>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>

        {notice && <Box sx={{ flexShrink: 0, px: 2, pt: 1.5 }}>{notice}</Box>}

        {loadFailed ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            {loadFailedText}
          </Typography>
        ) : text === null ? (
          <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            {/* mounted only once the text is loaded, so startEditing is decided from the real value */}
            <NotesEditor
              value={text}
              onChange={onChange}
              onBlur={flush}
              startEditing={!mobile || text === ""}
              plain={plain}
              placeholder={placeholder}
            />
            {problem && (
              <Typography variant="caption" color="error" role="alert" sx={{ flexShrink: 0, px: 2, pb: 1.5 }}>
                Not saved: {problem}
              </Typography>
            )}
          </>
        )}
      </Box>
    </OptionalModal>
  );
}
