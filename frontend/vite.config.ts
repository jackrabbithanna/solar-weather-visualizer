import {defineConfig} from 'vite';

export default defineConfig({
    // Relative assets work both in Wails' embedded server and in a local
    // production-build smoke test.
    base: './',
    build: {
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    return id.includes('/node_modules/three/') ? 'three' : undefined;
                },
            },
        },
    },
});
