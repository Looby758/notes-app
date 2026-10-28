import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { dictionaryPlugin } from './scripts/dictionaryPlugin'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), dictionaryPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // index: the app's own windows. web: every web page (see src/preload/web.ts).
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), web: resolve(__dirname, 'src/preload/web.ts') } } }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        ...shared,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
