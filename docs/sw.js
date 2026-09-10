self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || 'ETH Pending Monitor alert' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'ETH Pending Monitor', {
    body: payload.body || '',
    tag: payload.tag || 'eth-pending-monitor',
    requireInteraction: Boolean(payload.urgent),
    data: { url: payload.url || self.registration.scope },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || self.registration.scope));
});
