import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  // The workspace package is linked during local development. Keep both it
  // and the example on the application's Three.js instance.
  resolve: { dedupe: ['three'] },
  build:{rollupOptions:{input:{index:fileURLToPath(new URL('./index.html',import.meta.url)),matrix:fileURLToPath(new URL('./matrix.html',import.meta.url))}}},
});
