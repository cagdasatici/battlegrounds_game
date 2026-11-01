/** Registers the offline-shell service worker (WEB1). Production builds only; failure never blocks the game. */
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
