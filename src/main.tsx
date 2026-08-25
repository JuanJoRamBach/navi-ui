import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registered by hand instead of via vite-plugin-pwa's auto-injected
// script (injectRegister: false in vite.config.ts) specifically for
// updateViaCache: 'none' — GitHub Pages serves sw.js with
// Cache-Control: max-age=600, and without this the browser's update
// check can be satisfied by that 10-minute-old cached copy instead of
// actually fetching a newly-deployed worker. reg.update() on load is
// a second belt-and-suspenders push past whatever periodic check the
// browser would otherwise do on its own schedule.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, {
        type: import.meta.env.DEV ? 'module' : 'classic',
        updateViaCache: 'none',
      })
      .then(registration => registration.update())
      .catch(() => {
        // Non-fatal — push/offline just won't work this session. The
        // rest of the app (including local-only chat) still functions.
      });
  });
}
