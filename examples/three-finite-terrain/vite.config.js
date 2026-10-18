import { defineConfig } from 'vite';

export default defineConfig({
  // The workspace package is linked during local development. Keep both it
  // and the example on the application's Three.js instance.
  resolve: { dedupe: ['three'] },
});
