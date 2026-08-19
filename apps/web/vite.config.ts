import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const authApiTarget = process.env.VITE_AUTH_API_TARGET ?? "http://localhost:3002";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /auth 를 auth-api로 넘겨 프론트에서 호출할 때 CORS를 피하고,
    // 배포 시 경로 기반 라우팅과 구조를 맞춘다.
    proxy: {
      "/auth": { target: authApiTarget, changeOrigin: false },
    },
  },
});
