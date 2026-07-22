import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import OnboardingApp from './OnboardingApp';

const root = createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <OnboardingApp />
    </BrowserRouter>
  </React.StrictMode>,
);
