import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build inlines everything into dist/index.html, so the game
// runs by double-clicking the file and deploys to any static host as one file.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000 },
  server: { host: true, port: 5173 },
});
