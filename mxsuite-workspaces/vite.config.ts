import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mxsuiteWorkspaces',
      filename: 'remoteEntry.js',
      exposes: { './WorkspacesApp': './src/WorkspacesApp.tsx' },
      // Type assertion needed: plugin typings lack singleton/requiredVersion
      // but the underlying Module Federation runtime supports them.
      shared: {
        react: { singleton: true, requiredVersion: '^18.3.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.3.0' },
        'react-router-dom': { singleton: true, requiredVersion: '^6.26.0' },
        antd: { singleton: true, requiredVersion: '^5.21.0' },
      } as any,
    }),
  ],
  server: { port: 3002 },
  preview: { port: 3002 },
  build: { target: 'esnext', minify: true },
});
