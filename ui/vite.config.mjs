import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(root, '..', 'assets');
const versionInfo = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'build', 'version.json'), 'utf8'));

function devMedia() {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  };

  return {
    name: 'backdropbuddy-dev-media',
    configureServer(server) {
      server.middlewares.use('/dev-media/', (req, res, next) => {
        const urlPath = decodeURIComponent((req.url || '').split('?')[0]);
        const file = path.resolve(assetsDir, '.' + urlPath);

        if (!file.startsWith(assetsDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next();
          return;
        }

        res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(String(versionInfo.version || '0.0.0'))
  },
  plugins: [react(), devMedia(), viteSingleFile({ removeViteModuleLoader: true })],
  publicDir: false,
  build: {
    target: 'chrome120',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    modulePreload: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
