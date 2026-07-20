import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/billing": "http://localhost:3000",
    },
  },
});
