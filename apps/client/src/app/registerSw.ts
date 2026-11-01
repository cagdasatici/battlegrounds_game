/** Registers the offline-shell service worker (WEB1). Production builds only; failure never blocks the game. */
let pending: Promise<ServiceWorkerRegistration | null> | null = null;
/** Shared registration promise for the update watcher (WEB2); registers once. */
export const swRegistration = (): Promise<ServiceWorkerRegistration | null> => (pending ??= registerServiceWorker());

export async function registerServiceWorker(
  nav: Pick<Navigator, "serviceWorker"> | { serviceWorker?: undefined } = navigator,
  enabled: boolean = import.meta.env.PROD,
): Promise<ServiceWorkerRegistration | null> {
  if (!enabled || !nav.serviceWorker) return null;
  try {
    return await nav.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}
