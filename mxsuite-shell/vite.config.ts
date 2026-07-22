import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig(({ command }) => {
  // In dev (vite serve), micro-frontends run on separate ports.
  // In production (vite build), they are served from /mfe/<name>/ by nginx.
  const isDev = command === 'serve';

  const remotes = isDev
    ? {
        mxsuiteAdmin: 'http://localhost:3001/assets/remoteEntry.js',
        mxsuiteWorkspaces: 'http://localhost:3002/assets/remoteEntry.js',
        mxsuitePlanner: 'http://localhost:3003/assets/remoteEntry.js',
        mxsuiteChat: 'http://localhost:3004/assets/remoteEntry.js',
        mxsuiteOnboarding: 'http://localhost:3005/assets/remoteEntry.js',
      }
    : {
        mxsuiteAdmin: '/mfe/admin/assets/remoteEntry.js',
        mxsuiteWorkspaces: '/mfe/workspaces/assets/remoteEntry.js',
        mxsuitePlanner: '/mfe/planner/assets/remoteEntry.js',
        mxsuiteChat: '/mfe/chat/assets/remoteEntry.js',
        mxsuiteOnboarding: '/mfe/onboarding/assets/remoteEntry.js',
      };

  return {
    plugins: [
      react(),
      federation({
        name: 'mxsuiteShell',
        remotes,
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
    server: {
      port: 3000,
      proxy: {
        '/api': 'http://localhost:8080',
        '/ws': {
          target: 'http://localhost:8080',
          ws: true,
        },
      },
    },
    build: {
      target: 'esnext',
      minify: true,
    },
  };
});
