import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default ({ mode }: { mode: string }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget =
    env.VITE_API_PROXY_TARGET?.trim()
    || (env.VITE_API_URL?.trim().startsWith('http') ? env.VITE_API_URL.trim() : '')
    || 'http://localhost:3000';

  return defineConfig({
    base: '/admin/',
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true, secure: false },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2020',
    },
  });
};
