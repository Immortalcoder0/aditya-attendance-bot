import { createServer } from 'node:http';

import QRCode from 'qrcode';

/**
 * Minimal HTTP server, also doubling as the QR hand-off point.
 *
 * Started only because Render/Railway's "Web Service" deploy type expects
 * something listening on $PORT for health checks — running locally (no
 * PORT) is unaffected. Also serves `/qr`: the terminal QR code (via
 * qrcode-terminal in whatsapp.js) only renders correctly in a real TTY, and
 * gets wrapped into unscannable noise by web-based log viewers like
 * Render's. Serving the same QR payload as an actual PNG image sidesteps
 * that entirely — just open <service-url>/qr in a browser and scan it.
 */
export function startHealthServer(log, { getQr } = {}) {
  const port = process.env.PORT;
  if (!port) return { stop() {} };

  const server = createServer(async (req, res) => {
    if (req.url === '/qr' && getQr) {
      const qr = getQr();
      if (!qr) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('No QR pending — already linked, or not generated yet. Refresh in a few seconds.');
        return;
      }
      try {
        const png = await QRCode.toBuffer(qr, { width: 320, margin: 2 });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
      } catch (err) {
        log.error({ err: err.message }, 'failed generating QR image');
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Failed to render QR');
      }
      return;
    }

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
