import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server runs on 5173 (the API's CORS already allows this origin).
//
// The /api + /health proxy lets the app call the backend on the SAME origin as
// the page (set VITE_API_BASE="" in .env.local). That keeps local dev working
// AND makes remote access over Tailscale work: `tailscale serve` proxies the
// whole site to this dev server, and Vite forwards /api on to the FastAPI
// backend — so a phone opening https://<pc>.<tailnet>.ts.net never has to reach
// 127.0.0.1 (which, from the phone, would mean the phone itself).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind IPv4 explicitly. Vite's default "localhost" resolves to IPv6 ::1 on
    // Windows, but `tailscale serve` connects over 127.0.0.1 (IPv4) — a mismatch
    // that yields 502s. 127.0.0.1 keeps both on the same stack. (Same reason the
    // backend DB URL pins 127.0.0.1 — see CLAUDE.md "Environment gotchas".)
    host: "127.0.0.1",
    // Accept requests whose Host is this machine's Tailscale (MagicDNS) name,
    // e.g. rei-niamh.tail6ef996.ts.net — otherwise Vite blocks them as unknown.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
