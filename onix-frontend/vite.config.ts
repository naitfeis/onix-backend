import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Long-cache vendor chunks: React (framework) + Telegram SDK (optional Mini App path).
const manualChunks = (id: string) => {
  if (id.includes('node_modules')) {
    if (id.includes('react') || id.includes('react-dom')) {
      return 'framework';
    }
    if (id.includes('@twa-dev/sdk')) {
      return 'telegram';
    }
  }
};

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // Browser always uses relative /api (empty VITE_API_URL). Proxy target is separate.
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
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },

    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
  });
};