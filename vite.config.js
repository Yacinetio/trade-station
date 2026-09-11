import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'stylesheet-before-module-script',
      transformIndexHtml(html) {
        // Faster first paint: CSS loads before module script (splash/theme tokens appear sooner).
        return html.replace(
          /(<script[^>]*type="module"[^>]*>\s*<\/script>\s*)(<link[^>]*rel="stylesheet"[^>]*\/?>)/i,
          '$2\n    $1'
        );
      },
    },
  ],
  root: '.',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split heavy vendor libs out of the main bundle so the cold-start parse stays small.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Heaviest deps first; everything else stays in the default chunk to avoid
          // circular dependencies between react and shared utilities.
          if (id.includes('echarts') || id.includes('lightweight-charts')) return 'vendor-charts';
          if (id.includes('@tanstack/react-table') || id.includes('@tanstack/react-virtual')) return 'vendor-table';
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('cmdk') || id.includes('react-day-picker')) return 'vendor-ui';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173
  },
  base: './'
});
