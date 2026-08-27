import pino from 'pino';

import { config } from './config.js';
import { openStore } from './store/db.js';
import { createCommandHandler } from './bot/commands.js';
import { startWhatsApp } from './bot/whatsapp.js';
import { startScheduler } from './jobs/scheduler.js';
import { closeBrowser } from './portal/render.js';
import { startHealthServer } from './health.js';

const log = pino({ level: config.logLevel });

async function main() {
  const store = await openStore();
  const commands = createCommandHandler({ store, log });

  const wa = await startWhatsApp({
    onMessage: (jid, text) => commands.handle(jid, text),
    log,
  });

  const scheduler = startScheduler({ store, sendReply: wa.send, log });
  const health = startHealthServer(log);

  const shutdown = async () => {
    log.info('shutting down');
    health.stop();
    scheduler.stop();
    wa.stop();
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err: err.stack ?? err.message }, 'fatal startup error');
  process.exit(1);
});
