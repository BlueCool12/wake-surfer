import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { configureBrowserChatRuntime } from "./features/chat/transport/browserChatRuntime.ts";
import { configureVoiceRuntime } from "./features/voice/voiceRuntime.ts";
import { router } from "./routes.tsx";
import { applyTheme, getStoredTheme } from "./utils/theme.ts";

// 저장된 테마 선택이 있으면 첫 렌더 전에 적용해 깜빡임을 막는다.
applyTheme(getStoredTheme());

configureBrowserChatRuntime({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
});

// 통화는 채팅 게이트웨이가 아니라 미디어 게이트웨이에 별도 연결을 맺는다.
configureVoiceRuntime({
  gatewayUrl: import.meta.env.VITE_MEDIA_GATEWAY_URL ?? "ws://localhost:4000",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
