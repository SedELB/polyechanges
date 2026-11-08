import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'site',
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
