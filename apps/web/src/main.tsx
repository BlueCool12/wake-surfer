import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { configureBrowserChatRuntime } from "./features/chat/transport/browserChatRuntime.ts";
import { router } from "./routes.tsx";

configureBrowserChatRuntime({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
