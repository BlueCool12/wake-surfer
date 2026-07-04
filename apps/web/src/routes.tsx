import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  { path: "/login", element: <LoginPage /> },
]);
