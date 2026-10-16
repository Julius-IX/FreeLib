import AppLayout from "./AppLayout";
import { SnackbarHost } from "@/notifications/SnackbarHost";

export default function App() {
  return (
    <>
      <AppLayout />
      <SnackbarHost />
    </>
  );
}
