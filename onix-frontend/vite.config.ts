import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Умный сплиттинг framework-зависимостей для ускорения кэширования браузером [проф. 1]
const manualChunks = (id: string) => {
  if (id.includes('node_modules')) {
    if (id.includes('react') || id.includes('react-dom')) {
      return 'framework';
    }
  }
};

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const targetServer = env.VITE_API_URL || 'http://localhost:3000';

  // БРОНИРОВАННЫЙ СЕТЕВОЙ КАНАЛ API ПЛАТФОРМЫ [проф. 1]
  const apiProxyConfig = {
    target: targetServer,
    changeOrigin: true,
    secure: false,
    ws: true,
    // ИСПРАВЛЕНО: Убрали деструктивный rewrite, теперь префикс /api сохраняется для NestJS СУБД [проф. 1]
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
        // Пробрасываем шлюз для профилей, чата и отзывов [проф. 1]
        '/api': apiProxyConfig,
        // ДОБАВЛЕНО: Прямой прокси-канал для лотов Гаранта (/products/purchase и т.д.) [проф. 1]
        '/products': apiProxyConfig,
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