import { IconButton, InputAdornment, TextField } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { open } from "@tauri-apps/plugin-dialog";
import { notify } from "@/notifications/notify";

export function CoverField({
  value,
  onChange,
  error,
  helperText,
  onPreview,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  helperText?: string;
  onPreview?: () => void;
}) {
  const pickFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (typeof picked === "string") onChange(picked);
    } catch (e) {
      notify(`Couldn't open the file picker: ${String(e)}`, { severity: "error" });
    }
  };

  return (
    <TextField
      label="Cover (link or file)"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      helperText={helperText}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              {onPreview && (
                <IconButton aria-label="Preview cover" onClick={onPreview}>
                  <VisibilityIcon />
                </IconButton>
              )}
              <IconButton aria-label="Choose file" onClick={pickFile} edge="end">
                <FolderOpenIcon />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
