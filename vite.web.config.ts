import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pc from 'path'
import tailwindcss from '@tailwindcss/postcss'
import autoprefixer from 'autoprefixer'

// Minimal Vite config for the pure Web version.
// It completely ignores the Electron main/preload logic.

export default defineConfig({
  root: pc.resolve(__dirname, 'src/renderer'),
  base: './', // Use relative paths for assets so it can be hosted in subfolders
  plugins: [react()],
  build: {
    outDir: pc.resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: pc.resolve(__dirname, 'src/renderer/index.html')
      }
    }
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  resolve: {
    alias: {
      '@renderer': pc.resolve(__dirname, 'src/renderer/src'),
      '@': pc.resolve(__dirname, 'src/renderer/src'),
      // Important to alias out electron modules that might be accidentally imported
      'electron': 'identity-obj-proxy'
    }
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
})
