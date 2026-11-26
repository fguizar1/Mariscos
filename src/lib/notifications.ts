export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.error("Error registrando SW:", err);
    return null;
  }
}

export async function pedirPermisoNotificaciones(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  await registrarServiceWorker();
  if (Notification.permission === "granted") return "granted";
  return await Notification.requestPermission();
}

export async function enviarNotificacionPedidoListo(mesa: string, cantidad: number, platillo: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const titulo = `🍽️ ¡Listo para ${mesa}!`;
  const opciones: NotificationOptions & { vibrate?: number[] } = {
    body: `${cantidad}x ${platillo} ya salió y está listo para recoger.`,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: `listo-${mesa}-${Date.now()}`,
    vibrate: [200, 100, 200],
  };

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, opciones);
  } catch {
    new Notification(titulo, opciones);
  }
}
