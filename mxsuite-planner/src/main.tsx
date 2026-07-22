import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import PlannerApp from './PlannerApp';

const root = createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <PlannerApp />
    </BrowserRouter>
  </React.StrictMode>,
);
