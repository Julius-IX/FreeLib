import { RouteObject } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import { notify } from "@util/notify";

function BrowseHome() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">Browse</Typography>
      <Button variant="outlined" onClick={() => notify("This is a default message")}> Test Default </Button>
      <Button variant="outlined" onClick={() => notify("This is a success message", { severity: "success"})}> Test Success </Button>
      <Button variant="outlined" onClick={() => notify("This is an info message", { severity: "info"})}> Test Info </Button>
      <Button variant="outlined" onClick={() => notify("This is a warning message", { severity: "warning"})}> Test Warning </Button>
      <Button variant="outlined" onClick={() => notify("This is an error message", { severity: "error"})}> Test Error </Button>
    </Box>
  );
}

export const browseRoutes: RouteObject[] = [
  { index: true, element: <BrowseHome /> },
];
