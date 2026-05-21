import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Auto-update the service worker when a new version is available.
// (vite-plugin-pwa's `autoUpdate` mode handles activation; we just register here.)
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}
