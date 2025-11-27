/**
 * Vite configuration for Maestro Web Interface
 *
 * This config builds the web interface (both mobile and desktop)
 * as a standalone bundle that can be served by the Fastify server.
 *
 * Output: dist/web/
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf-8')
);
const appVersion = process.env.VITE_APP_VERSION || packageJson.version;

export default defineConfig({
  plugins: [react()],

  // Entry point for web interface
  root: path.join(__dirname, 'src/web'),

  // Use relative paths for assets (served from Fastify)
  base: './',

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },

  resolve: {
    alias: {
      // Allow importing from renderer types/constants
      '@renderer': path.join(__dirname, 'src/renderer'),
      '@web': path.join(__dirname, 'src/web'),
      '@shared': path.join(__dirname, 'src/shared'),
    },
  },

  build: {
    outDir: path.join(__dirname, 'dist/web'),
    emptyOutDir: true,

    // Generate source maps for debugging
    sourcemap: true,

    rollupOptions: {
      input: {
        // Single entry point that handles routing to mobile/desktop
        main: path.join(__dirname, 'src/web/index.html'),
      },
      output: {
        // Organize output by type
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',

        // Manual chunking for better caching
        manualChunks: {
          // React core in its own chunk
          react: ['react', 'react-dom'],
        },
      },
    },

    // Target modern browsers (web interface doesn't need legacy support)
    target: 'es2020',

    // Minimize bundle size
    minify: 'esbuild',

    // Report chunk sizes
    reportCompressedSize: true,
  },

  // Development server (for testing web interface standalone)
  server: {
    port: 5174, // Different from renderer dev server (5173)
    strictPort: true,
    // Proxy API calls to the running Maestro app during development
    proxy: {
      '/api': {
        target: 'http://localhost:45678',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:45678',
        ws: true,
      },
    },
  },

  // Preview server for testing production build
  preview: {
    port: 5175,
    strictPort: true,
  },

  // Enable CSS code splitting
  css: {
    devSourcemap: true,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
