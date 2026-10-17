import { Tab, Tabs } from "@mui/material";
import { useLibrary } from "../LibraryContext";

/**
 * The row of shelf tabs under the library's top bar. Renders nothing while no shelves are
 * defined: the library is then a single list.
 */
export default function ShelfTabs() {
  const { shelfTabs, activeShelf, selectShelf } = useLibrary();
  if (shelfTabs.length === 0 || activeShelf === null) return null;

  return (
    <Tabs
      value={activeShelf}
      onChange={(_, key) => selectShelf(key)}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label="Shelves"
      sx={{ minHeight: 40, mb: 1, flexShrink: 0 }}
    >
      {shelfTabs.map((t) => (
        <Tab key={t.key} value={t.key} label={t.label} sx={{ minHeight: 40, textTransform: "none" }} />
      ))}
    </Tabs>
  );
}
