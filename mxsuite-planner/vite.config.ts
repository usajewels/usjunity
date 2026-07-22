import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mxsuitePlanner',
      filename: 'remoteEntry.js',
      exposes: { './PlannerApp': './src/PlannerApp.tsx' },
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
  server: { port: 3003 },
  preview: { port: 3003 },
  build: { target: 'esnext', minify: true },
});
