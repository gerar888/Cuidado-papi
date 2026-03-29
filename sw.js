// ============================================================
//  Service Worker — Cuidado Papá
//  Maneja notificaciones en segundo plano / pantalla bloqueada
// ============================================================

const SW_VERSION = 'v1.0';
const scheduledTimeouts = new Map();

self.addEventListener('install', () => {
  console.log(`[SW ${SW_VERSION}] Installed`);
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log(`[SW ${SW_VERSION}] Activated`);
  e.waitUntil(clients.claim());
});

// ──────────────────────────────────────────────────────────────
// Mensajes desde el app principal
// ──────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  if (type === 'SCHEDULE_ALARMS') {
    scheduleAlarms(data.alarmas || []);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true, count: scheduledTimeouts.size });
    }
  }

  if (type === 'CANCEL_ALL') {
    cancelAll();
  }

  if (type === 'PING') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ pong: true, alarms: scheduledTimeouts.size });
    }
  }
});

// ──────────────────────────────────────────────────────────────
// Programar alarmas
// ──────────────────────────────────────────────────────────────
function scheduleAlarms(alarmas) {
  cancelAll();

  alarmas.forEach(alarma => {
    const delay = new Date(alarma.hora_programada).getTime() - Date.now();
    if (delay <= 0 || delay > 26 * 3600 * 1000) return; // Solo próximas 26 horas

    const tid = setTimeout(() => {
      fireNotification(alarma);
      scheduledTimeouts.delete(alarma.id);
    }, delay);

    scheduledTimeouts.set(alarma.id, tid);
  });

  console.log(`[SW] Alarmas programadas: ${scheduledTimeouts.size}`);
}

function cancelAll() {
  scheduledTimeouts.forEach(tid => clearTimeout(tid));
  scheduledTimeouts.clear();
}

// ──────────────────────────────────────────────────────────────
// Mostrar notificación
// ──────────────────────────────────────────────────────────────
async function fireNotification(alarma) {
  const hora = new Date(alarma.hora_programada).toLocaleTimeString('es-CR', {
    hour: '2-digit', minute: '2-digit'
  });

  const options = {
    body: `${alarma.dosis} · ${hora}`,
    icon: './icon.svg',
    badge: './badge.svg',
    tag: alarma.id,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 800],
    silent: false,
    data: alarma,
    actions: [
      { action: 'tomado',   title: '✅ Ya tomado' },
      { action: 'posponer', title: '⏰ En 10 min'  }
    ]
  };

  await self.registration.showNotification(`💊 ${alarma.nombre}`, options);

  // Marcar en Firebase que la alarma sonó
  try {
    await fetch(`${alarma.firebase_url}/${alarma.toma_path}/alarma_sonada.json`, {
      method: 'PUT',
      body: JSON.stringify(new Date().toISOString())
    });
  } catch (_) { /* offline, no pasa nada */ }
}

// ──────────────────────────────────────────────────────────────
// Click en acciones de notificación
// ──────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  const { action, notification } = event;
  const alarma = notification.data;
  notification.close();

  if (action === 'tomado') {
    event.waitUntil(confirmarToma(alarma));
  } else if (action === 'posponer') {
    event.waitUntil(posponerToma(alarma));
  } else {
    // Click en la notificación (sin acción específica): abrir app
    event.waitUntil(abrirApp());
  }
});

async function confirmarToma(alarma) {
  try {
    await fetch(`${alarma.firebase_url}/${alarma.toma_path}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmado: true,
        confirmado_por: 'notificación',
        hora_confirmacion: new Date().toISOString()
      })
    });
  } catch (_) { /* offline */ }
  await abrirApp();
}

async function posponerToma(alarma) {
  const nueva = { ...alarma, id: alarma.id + '_pospuesto' };
  nueva.hora_programada = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const tid = setTimeout(() => {
    fireNotification(nueva);
    scheduledTimeouts.delete(nueva.id);
  }, 10 * 60 * 1000);

  scheduledTimeouts.set(nueva.id, tid);
}

async function abrirApp() {
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (allClients.length > 0) {
    return allClients[0].focus();
  }
  return clients.openWindow('./');
}
