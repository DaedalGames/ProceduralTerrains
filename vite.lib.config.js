import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const forbidden = /(?:^|\/)(?:react(?:-dom)?|electron|leaflet)(?:\/|$)|\/(?:platform|auth|project|components)\//;

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'terrain-runtime-boundary',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (forbidden.test(id)) this.error(`Studio dependency reached terrain package: ${id}`);
      }
    },
  }],
  build: {
    outDir: 'packages/procedural-terrains/dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2020',
    lib: { entry: fileURLToPath(new URL('./packages/procedural-terrains/index.js', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { external: [/^three(?:$|\/)/] },
  },
});
