import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only proxy so the browser sees the API as same-origin during local
// development (avoids extra CORS/cookie complexity); production serves the
// built frontend separately and talks to the API's real origin via
// VITE_API_BASE_URL (see src/api/client.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
