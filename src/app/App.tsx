import AppLayout from "./AppLayout";
import { SnackbarHost } from "@/notifications/SnackbarHost";
import { UpdateHost } from "@/features/updates/UpdateDialog";

export default function App() {
  return (
    <>
      <AppLayout />
      <SnackbarHost />
      <UpdateHost />
    </>
  );
}
