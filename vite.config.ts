import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Node server serves a fixed allow-list of files from dist/ (see server/index.mjs),
// so the build emits stable names: index.html, app.js and style.css.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: '',
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: asset => (asset.names?.[0] ?? '').endsWith('.css') ? 'style.css' : '[name][extname]',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4173',
      '/oauth': 'http://127.0.0.1:4173',
    },
  },
  test: {
    include: ['tests/web/**/*.test.ts'],
    exclude: ['tests/web/pdf.test.ts'],
  },
});
