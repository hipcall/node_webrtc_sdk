import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/sdk/index.ts'),
      name: 'Hipcall',
      fileName: (format) => `hipcall-webrtc-sdk.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // JsSIP ve WebRTC paket içi gömülü gelsin veya harici tanımlanabilir
      output: {
        globals: {
          jssip: 'JsSIP',
        },
      },
    },
  },
});

