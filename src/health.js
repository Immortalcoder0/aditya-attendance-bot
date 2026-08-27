import { createServer } from 'node:http';

/**
 * Minimal HTTP server that just answers 200 to anything.
 *
 * This bot has no HTTP API — it only exists because Railway/Render's "Web
 * Service" deploy type expects something listening on $PORT for health
 * checks. Only starts if PORT is actually set, so running locally (no PORT)
 * is unaffected.
 */
export function startHealthServer(log) {
  const port = process.env.PORT;
  if (!port) return { stop() {} };

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });

  server.listen(port, () => log.info({ port }, 'health server listening'));

  return {
    stop() {
      server.close();
    },
  };
}
