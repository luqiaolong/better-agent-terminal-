import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['@lydell/node-pty', 'ws', 'bufferutil', 'utf-8-validate']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      },
      {
        // Headless server entry — runs without Electron. Bundled separately
        // so it can be packaged as a CLI (bin/bat-server.js).
        entry: 'electron/server-cli.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // electron must stay external — the CLI runs in plain Node and
              // never imports it (only type-only references survive compile).
              external: ['electron', '@lydell/node-pty', 'ws', 'bufferutil', 'utf-8-validate']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    rollupOptions: {
      external: ['@lydell/node-pty'],
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-unicode11'],
          'hljs': ['highlight.js'],
        }
      }
    }
  }
})
