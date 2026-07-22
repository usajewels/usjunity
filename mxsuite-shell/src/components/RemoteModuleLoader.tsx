import React, { Suspense } from 'react';
import { Spin } from 'antd';
import { ErrorBoundary } from './ErrorBoundary';

interface RemoteModuleLoaderProps {
  module: React.LazyExoticComponent<React.ComponentType>;
  fallbackTitle?: string;
}

export function RemoteModuleLoader({ module: Module, fallbackTitle }: RemoteModuleLoaderProps) {
  return (
    <ErrorBoundary fallbackTitle={fallbackTitle}>
      <Suspense fallback={
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <Spin size="large" tip="Loading module..." />
        </div>
      }>
        <Module />
      </Suspense>
    </ErrorBoundary>
  );
}
