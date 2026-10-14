import { RouteObject, useNavigate } from "react-router-dom";
import { Box, Typography, Button } from "@mui/material";
import FabActionStack from "@/components/FabActionStack";
import BookIcon from '@mui/icons-material/Book';
import FolderIcon from '@mui/icons-material/Folder';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { isDesktop, isMobile, once } from "@/util/misc";
import { RouteHandle } from "@/app/tabs";
import UpdateFilterFields from "./screens/UpdateFilterFields";
import NewBook from "./screens/NewBook";
import CoverPreviewPage, { COVER_SEGMENT } from "./screens/CoverPreview";
import TopBar from "./components/TopBar";
import { LibraryProvider, useLibrary } from "./LibraryContext";
import CardGrid from "./components/CardGrid";

function LibraryHomeWrapper() {
  return (
    <LibraryProvider>
      <LibraryHome />
    </LibraryProvider>
  );
}

function LibraryHome() {
  const navigate = useNavigate();
  const { books } = useLibrary();

  const actions = [
    { label: 'Add Book', icon: <BookIcon />, onClick: () => navigate(LibraryPath.AddBook) },
    { label: 'Update Filter Fields', icon: <FolderIcon />, onClick: () => navigate(LibraryPath.UpdateFilterFields) },
  ];
  if (isMobile()) {
    actions.splice(1, 0, { label: 'Scan Book', icon: <QrCodeScannerIcon />, onClick: () => navigate(LibraryPath.Scan) });
  }

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <TopBar />
      <CardGrid items={books} />
      <FabActionStack
        actions={actions}
      />

    </Box>
  );
}

// TODO: extract and implement
function ScanBook() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Typography variant="h5">Scan Book</Typography>
      <Button variant="outlined" onClick={() => navigate(-1)}> Back </Button>
    </Box>
  );
}

export const LibraryPath = {
  Scan: "scan",
  UpdateFilterFields: "update-filter-fields",
  AddBook: "add-book",
  /** Nested under AddBook, mobile only: add-book/cover */
  Cover: COVER_SEGMENT,
} as const;

export type LibraryPath = (typeof LibraryPath)[keyof typeof LibraryPath];

// Picked once, on first use. Desktop: add-book is a modal and the cover preview floats beside
// it inside the same route. Mobile: add-book is a page and the preview is a nested route
// (add-book/cover) with its own page.
const addBookRoute = once((): RouteObject =>
  isMobile()
    ? {
      path: LibraryPath.AddBook,
      element: <NewBook />,
      handle: { hideNav: true } satisfies RouteHandle,
      children: [{ path: LibraryPath.Cover, element: <CoverPreviewPage /> }],
    }
    : {
      path: LibraryPath.AddBook,
      element: <NewBook />,
      handle: { modal: true } satisfies RouteHandle,
    }
);

export const libraryRoutes: RouteObject[] = [
  { index: true, element: <LibraryHomeWrapper /> },
  { path: LibraryPath.Scan, element: <ScanBook />, handle: { hideNav: isMobile() } satisfies RouteHandle },
  { path: LibraryPath.UpdateFilterFields, element: <UpdateFilterFields />, handle: { hideNav: isMobile(), modal: isDesktop() } satisfies RouteHandle },
  addBookRoute(),
];
