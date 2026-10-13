import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// رقم النسخة: يتغير مع كل بناء، ويُكتب في /version.json لتعرف الصفحات المفتوحة أن نسخة جديدة نُشرت (client/src/lib/appVersion.ts)
const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const versionFile: Plugin = {
  name: "version-file",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // مكتبات كبيرة في ملفات منفصلة: تُحمَّل عند الحاجة وتبقى في ذاكرة المتصفح بين التحديثات
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    // التجربة المحلية: خادم PHP (pnpm run dev:api) على المنفذ 8000
    proxy: { "/api": "http://127.0.0.1:8000" },
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
