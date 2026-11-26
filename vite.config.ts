import { defineConfig } from 'vite';

// The Android web assets live in src/ and are built into www/,
// which is the Capacitor webDir (see capacitor.config.ts).
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../www',
    emptyOutDir: true,
  },
});
