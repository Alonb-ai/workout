import { useCallback, useState, useEffect } from 'react';

/**
 * Web Notifications wrapper.
 *
 * Limitations on iOS:
 *  - Web Push works on iOS 16.4+ ONLY when the PWA has been **installed to Home Screen**.
 *  - Even when supported, background scheduling depends on the OS waking the SW. We
 *    therefore complement push with an in-app interval check (`scheduler.ts`).
 *
 * On Android Chrome the standard Notification API works in installed PWAs without
 * Push messaging.
 */

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function getNotifPermission(): NotifPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifPermission;
}

export function useNotificationPermission(): NotifPermission {
  const [p, setP] = useState<NotifPermission>(getNotifPermission());
  useEffect(() => {
    // Permissions don't fire change events broadly, so poll once.
    setP(getNotifPermission());
  }, []);
  return p;
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
  // Prefer SW-shown notifications (supports actions; iOS PWA requires SW path).
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
