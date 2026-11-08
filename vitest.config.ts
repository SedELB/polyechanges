import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'pipeline',
          environment: 'node',
          include: ['pipeline/**/*.test.ts', 'shared/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'site',
          environment: 'jsdom',
          include: ['site/src/**/*.test.tsx', 'site/src/**/*.test.ts'],
          setupFiles: ['site/src/test/setup.ts'],
        },
      },
    ],
  },
});
