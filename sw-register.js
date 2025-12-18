/**
 * Service Worker Registration Script
 * Handles registration with iOS Safari-specific workarounds
 */

(function () {
  'use strict';

  // Feature detection
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return;
  }

  /**
   * Detect iOS Safari
   */
  function isIOSSafari() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isWebkit = /WebKit/.test(ua);
    const isNotChrome = !/CriOS/.test(ua);
    const isNotFirefox = !/FxiOS/.test(ua);
    return isIOS && isWebkit && isNotChrome && isNotFirefox;
  }

  /**
   * Detect if running as installed PWA
   */
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  /**
   * Show update notification to user
   */
  function showUpdateNotification(registration) {
    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'sw-update-notification';
    notification.innerHTML = `
      <style>
        #sw-update-notification {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #1e1e2e;
          color: #cdd6f4;
          padding: 16px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 16px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 14px;
          max-width: 90vw;
        }
        #sw-update-notification button {
          background: #89b4fa;
          color: #1e1e2e;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }
        #sw-update-notification button:hover {
          background: #b4befe;
        }
        #sw-update-notification .dismiss {
          background: transparent;
          color: #6c7086;
          padding: 4px 8px;
        }
      </style>
      <span>A new version is available!</span>
      <button id="sw-update-btn">Update</button>
      <button class="dismiss" id="sw-dismiss-btn">Later</button>
    `;

    document.body.appendChild(notification);

    // Handle update button
    document.getElementById('sw-update-btn').addEventListener('click', () => {
      notification.remove();

      // Tell waiting SW to take control
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });

    // Handle dismiss button
    document.getElementById('sw-dismiss-btn').addEventListener('click', () => {
      notification.remove();
    });
  }

  /**
   * Main registration function
   */
  async function registerServiceWorker() {
    try {
      console.log('[PWA] Registering service worker...');

      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './',
      });

      console.log('[PWA] Service worker registered with scope:', registration.scope);

      // Check for updates periodically (every 60 seconds)
      setInterval(() => {
        registration.update().catch(console.error);
      }, 60 * 1000);

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[PWA] New service worker installing...');

        newWorker.addEventListener('statechange', () => {
          console.log('[PWA] Service worker state:', newWorker.state);

          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content available, show update notification
            console.log('[PWA] New version available');
            showUpdateNotification(registration);
          }
        });
      });

      // Listen for controller change (SW took over)
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Controller changed');

        if (refreshing) return;
        refreshing = true;

        /**
         * iOS Safari Workaround:
         * Safari's memory cache can interfere with service worker responses.
         * A hard reload ensures all resources are fetched through the new SW.
         */
        if (isIOSSafari()) {
          console.log('[PWA] iOS Safari detected - performing hard reload');
          // Small delay to ensure SW is fully active
          setTimeout(() => {
            window.location.reload();
          }, 100);
        } else {
          // Other browsers can usually reload normally
          window.location.reload();
        }
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SW_ACTIVATED') {
          console.log('[PWA] Service worker activated, version:', event.data.version);
        }
      });

      // Check if there's already an active SW
      if (registration.active) {
        console.log('[PWA] Service worker already active');
      }

      // Check if there's a waiting SW (from a previous session)
      if (registration.waiting) {
        console.log('[PWA] Service worker waiting to activate');
        showUpdateNotification(registration);
      }

      return registration;

    } catch (error) {
      console.error('[PWA] Service worker registration failed:', error);
      throw error;
    }
  }

  /**
   * iOS-specific: Handle app resume from background
   * Safari may kill the SW when app is backgrounded, need to re-establish connection
   */
  if (isIOSSafari() && isStandalone()) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[PWA] iOS app resumed from background');

        // Re-check SW status
        if (navigator.serviceWorker.controller) {
          console.log('[PWA] Service worker still controlling');
        } else {
          console.log('[PWA] Service worker controller lost, may need reload');
          // Optional: Trigger a reload to restore SW control
          // window.location.reload();
        }
      }
    });
  }

  /**
   * Log PWA installation prompt availability
   */
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('[PWA] Install prompt available');
    e.preventDefault();
    deferredPrompt = e;

    // You can show a custom install button here if desired
    // showInstallButton(deferredPrompt);
  });

  /**
   * Log when PWA is installed
   */
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');
    deferredPrompt = null;
  });

  /**
   * Initialize when DOM is ready
   */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerServiceWorker);
  } else {
    registerServiceWorker();
  }

  // Expose registration function for manual use
  window.registerServiceWorker = registerServiceWorker;

  // Expose iOS detection for debugging
  window.pwaInfo = {
    isIOSSafari: isIOSSafari(),
    isStandalone: isStandalone(),
  };

  console.log('[PWA] Registration script loaded', window.pwaInfo);

})();
