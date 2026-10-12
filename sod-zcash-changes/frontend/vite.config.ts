import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` in sod-zcash serves the coordinator API on :8787.
    proxy: { "/api": "http://localhost:8787", "/dev": "http://localhost:8787" },
  },
});
