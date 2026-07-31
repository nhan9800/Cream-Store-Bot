import { ActivityType } from 'discord.js';
import { db } from '../database/db.js';

let presenceIntervalHandle = null;

function safeCount(sql, fallback = 0) {
  try {
    const row = db.prepare(sql).get();
    const value = row?.total ?? row?.count ?? fallback;
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch {
    return fallback;
  }
}

function getPresenceTemplates() {
  const processing = safeCount(`
    SELECT COUNT(*) AS total
    FROM orders
    WHERE status IN ('PENDING_PAYMENT', 'PROCESSING')
  `);

  const completed = safeCount(`
    SELECT COUNT(*) AS total
    FROM orders
    WHERE status = 'COMPLETED'
  `);

  return [
    {
      status: 'online',
      type: ActivityType.Watching,
      name: `Cenar Store | /order`,
    },
    {
      status: 'online',
      type: ActivityType.Playing,
      name: `PayOS thanh toán tự động`,
    },
    {
      status: 'idle',
      type: ActivityType.Listening,
      name: `${processing} đơn đang xử lý`,
    },
    {
      status: 'dnd',
      type: ActivityType.Competing,
      name: `${completed} đơn đã hoàn thành`,
    },
    {
      status: 'online',
      type: ActivityType.Watching,
      name: `Ticket & bảo hành 24/7`,
    },
  ];
}

function applyPresence(client, index) {
  if (!client?.user) return;
  const templates = getPresenceTemplates();
  const current = templates[index % templates.length];

  client.user.setPresence({
    status: current.status,
    activities: [
      {
        name: current.name,
        type: current.type,
      },
    ],
  });
}

export function startPresenceRotation(client) {
  if (presenceIntervalHandle) return;

  let index = 0;
  applyPresence(client, index);

  const intervalMinutes = Number(process.env.PRESENCE_ROTATION_INTERVAL_MINUTES ?? 1);
  presenceIntervalHandle = setInterval(() => {
    index += 1;
    applyPresence(client, index);
  }, Math.max(1, intervalMinutes) * 60 * 1000);

  console.log(`[V11.5] Presence rotation đang chạy mỗi ${Math.max(1, intervalMinutes)} phút.`);
}

export function stopPresenceRotation() {
  if (presenceIntervalHandle) {
    clearInterval(presenceIntervalHandle);
    presenceIntervalHandle = null;
  }
}
