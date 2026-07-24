import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Named chunks for ops / lazy route map.
 * App screens use dynamic import() — Rollup creates separate files;
 * manualChunks only shapes vendor + shared helpers.
 */
const manualChunks = (id: string) => {
  if (id.includes('node_modules')) {
    if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
      return 'framework';
    }
    // Loaded only via dynamic import inside real Mini App (never on www boot).
    if (id.includes('@twa-dev/sdk')) {
      return 'telegram';
    }
  }
  // Keep screen shared helpers out of the shell when pulled by a lazy screen.
  if (id.includes('/src/screens/shared')) {
    return 'shared';
  }
};

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget =
    env.VITE_API_PROXY_TARGET?.trim()
    || (env.VITE_API_URL?.trim().startsWith('http') ? env.VITE_API_URL.trim() : '')
    || 'http://localhost:3000';

  const apiProxyConfig = {
    target: proxyTarget,
    changeOrigin: true,
    secure: false,
    ws: true,
    onError: (err: Error, _req: IncomingMessage, res: ServerResponse) => {
      console.error('[🚨 ONIX PROXY ERROR]:', err);
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Backend service is currently unavailable.');
      }
    },
  };

  return defineConfig({
    plugins: [
      react(),
      tsconfigPaths(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [
          'favicon.svg',
          'icons/favicon-32.png',
          'icons/apple-touch-icon.png',
          'brand/onix-mark.png',
        ],
        manifest: {
          name: 'ONIX',
          short_name: 'ONIX',
          description: 'ONIX — безопасный маркетплейс цифровых товаров',
          lang: 'ru',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#000000',
          theme_color: '#000000',
          categories: ['shopping', 'finance'],
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/ws(?:\/|$)/],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api') || url.pathname.startsWith('/ws'),
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],

    server: {
      port: Number(env.VITE_DEV_PORT) || 5173,
      proxy: {
        '/api': apiProxyConfig,
        '/ws': apiProxyConfig,
      },
    },

    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      target: 'es2020',
      cssCodeSplit: true,
      modulePreload: {
        resolveDependencies: (_filename, deps) => {
          // Preload only framework for initial navigation — screens fetch on demand.
          return deps.filter((dep) => dep.includes('framework'));
        },
      },
      rollupOptions: {
        output: {
          manualChunks,
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },

    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
  });
};
