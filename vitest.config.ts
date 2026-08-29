import { defineConfig } from 'vitest/config';

// Sem vite-tsconfig-paths: o tsconfig.json deste projeto nao define "paths",
// e o proprio vitest avisa que o plugin e redundante.
// NAO adicione plugin esbuild/swc aqui: o pipeline Oxc do vitest emite
// decorator metadata corretamente, e o esbuild NAO — trocar quebra toda a DI.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
