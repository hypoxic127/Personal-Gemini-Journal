import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@journal/shared': path.resolve(__dirname, 'shared/src/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/ai-studio-baseline/**'],
  },
});