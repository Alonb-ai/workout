import { useCallback, useState, useEffect } from 'react';

/**
 * Web Notifications wrapper.
 *
 * Platform behavior:
 *  - Android / Desktop Chromium / Firefox: standard Notification API + SW.
 *  - iOS Safari (NOT installed): Notification API is **not exposed**. The user
 *    must Add to Home Screen first, then open the PWA — only then will
 *    `Notification` be defined.
 *  - iOS PWA (16.4+, installed to Home Screen): Notification API + SW work.
 *  - Insecure contexts (non-HTTPS, localhost OK): API unavailable.
 *
 * In-app scheduler (`features/supplements/scheduler.ts`) complements OS push by
 * firing notifications every 30s while the app is open, since background SW
 * wake-up varies wildly by platform.
 */

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface PlatformInfo {
  isIOS: boolean;
  isStandalone: boolean;
  isSecureContext: boolean;
}

export function getPlatformInfo(): PlatformInfo {
  if (typeof window === 'undefined') {
    return { isIOS: false, isStandalone: false, isSecureContext: false };
  }
  const ua = window.navigator.userAgent || '';
  // iPadOS 13+ reports as Mac but has touch; check both UA and touch flag.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && 'ontouchend' in document);
  const standaloneFromMatch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS-specific legacy property
  const standaloneFromNavigator =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isStandalone = standaloneFromMatch || standaloneFromNavigator;
  const isSecureContext = window.isSecureContext === true;
  return { isIOS, isStandalone, isSecureContext };
}

export function getNotifPermission(): NotifPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifPermission;
}

export function useNotificationPermission(): NotifPermission {
  const [p, setP] = useState<NotifPermission>(getNotifPermission());
  useEffect(() => {
    setP(getNotifPermission());
  }, []);
  return p;
}

export function usePlatformInfo(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(getPlatformInfo());
  useEffect(() => {
    setInfo(getPlatformInfo());
    // Re-check when display-mode changes (user installs PWA mid-session).
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setInfo(getPlatformInfo());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return info;
}

export function useRequestNotificationPermission() {
  return useCallback(async (): Promise<NotifPermission> => {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      const res = await Notification.requestPermission();
      return res as NotifPermission;
    } catch {
      return 'denied';
    }
  }, []);
}

/** Show a notification. On iOS this only works in an installed PWA + via SW. */
export async function showNotification(
  title: string,
  options?: NotificationOptions,
): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        badge: '/icons/icon-192.png',
        icon: '/icons/icon-192.png',
        ...options,
      });
      return;
    } catch {
      // fall through to direct Notification
    }
  }
  new Notification(title, options);
}
