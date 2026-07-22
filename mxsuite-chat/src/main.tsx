import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import ChatApp from './ChatApp';

const root = createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ChatApp />
    </BrowserRouter>
  </React.StrictMode>,
);
