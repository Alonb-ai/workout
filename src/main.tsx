import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Fonts are bundled, not fetched from a CDN: this app is used in a gym, and an
// offline-first PWA that falls back to the system Hebrew face the moment the
// signal drops is not offline-first. Vite fingerprints the woff2 files and the
// service worker precaches them.
import '@fontsource-variable/heebo';
import '@fontsource-variable/jetbrains-mono';
// ponytail: this pulls in the Cyrillic/Greek/Vietnamese subsets too (~60 kB of
// precache this app will never render). The package exposes no per-subset entry
// point, and hand-writing @font-face against its internal file layout would
// break on the next update. Revisit only if the precache budget starts to hurt.
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
