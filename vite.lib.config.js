import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const forbidden = /(?:^|\/)(?:react(?:-dom)?|electron|leaflet)(?:\/|$)|\/(?:platform|auth|project|components)\//;

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [{
    name: 'terrain-runtime-boundary',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (forbidden.test(id)) this.error(`Studio dependency reached terrain package: ${id}`);
      }
    },
  }],
  worker: { format: 'es' },
  build: {
    outDir: 'packages/procedural-terrains/dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'es2020',
    lib: { entry: Object.fromEntries(["index", "infinite", "planet", "mini", "water", "clouds", "render", "assets", "export", "real-world", "documents", "viewer", "generation"].map(name => [name, fileURLToPath(new URL(`./packages/procedural-terrains/${name}.js`, import.meta.url))])), formats: ['es'], fileName: (_format,name) => `${name}.js` },
    rollupOptions: { external: [/^three(?:$|\/)/, 'fflate'] },
  },
});
