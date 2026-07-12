import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Use threshold:0 and deleteOriginFile:false to avoid Windows absolute-path bug
      // in vite-plugin-compression@0.5.x which resolves against process.cwd().
      viteCompression({
        algorithm: 'gzip',
        ext: '.gz',
        deleteOriginFile: false,
        threshold: 1024,
      }),
      viteCompression({
        algorithm: 'brotliCompress',
        ext: '.br',
        deleteOriginFile: false,
        threshold: 1024,
      }),
    ],
    optimizeDeps: {
      // Ensure react-is (peer dep of recharts) is pre-bundled by Vite
      // so Rollup can resolve it during production build.
      include: ['react-is'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Proxy all /api/ requests to the Express backend on port 3000
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data-store.json']
      },
    },
  };
});
