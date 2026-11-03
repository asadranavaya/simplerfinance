import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import process from 'node:process'
import { validateServerOrigin } from './src/util/apiTransport.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const appBuild = mode === 'app' || mode === 'app-preview';
  const appServerOrigin = appBuild ? validateServerOrigin(process.env.VITE_API_ORIGIN || 'https://simplerfinance.net') : '';
  return {
    define: {
      'import.meta.env.APP_BUILD': JSON.stringify(appBuild),
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify(appServerOrigin),
    },
    plugins: [react(), ...(appBuild ? [{
      name: 'app-feature-boundary',
      generateBundle(_, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const [id, module] of Object.entries(chunk.modules)) {
            const excluded = /(?:node_modules\/(?:jspdf|jspdf-autotable|pdfjs-dist|pdf-parse|papaparse|html2canvas)\/|\/ImportCsv\.jsx|\/pages\/admin_dashboard\.jsx)/.test(id);
            if (module.renderedLength > 0 && excluded) throw new Error(`Unsupported app feature included: ${id}`);
          }
        }
      },
    }] : [])],
    root: currentDirectory,
    base: '/',
    server: {
      proxy: { '/api': 'http://localhost:3001' },
    },
    build: {
      outDir: path.resolve(currentDirectory, appBuild ? '../dist-app' : '../dist'),
      emptyOutDir: appBuild,
      sourcemap: false,
      minify: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            charts: ['chart.js', 'react-chartjs-2', 'chartjs-plugin-datalabels'],
          },
        },
      }
    },
  };
})
