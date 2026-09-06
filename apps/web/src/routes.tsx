import { Navigate, createBrowserRouter } from "react-router-dom";
import LoginPage from "./pages/LoginPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <LoginPage /> },
  // 임시: 방 목록 API가 생기기 전까지 샘플 채널로 보낸다.
  { path: "/rooms", element: <Navigate to="/rooms/test" replace /> },
  { path: "/rooms/:channelId", lazy: () => import("./pages/ChatChannelPage") },
]);
