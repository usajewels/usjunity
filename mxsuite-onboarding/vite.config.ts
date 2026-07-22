import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'mxsuiteOnboarding',
      filename: 'remoteEntry.js',
      exposes: { './OnboardingApp': './src/OnboardingApp.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^18.3.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.3.0' },
        'react-router-dom': { singleton: true, requiredVersion: '^6.26.0' },
        antd: { singleton: true, requiredVersion: '^5.21.0' },
      } as any,
    }),
  ],
  server: { port: 3005 },
  preview: { port: 3005 },
  build: { target: 'esnext', minify: true },
});
