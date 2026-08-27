import { mkdir } from 'node:fs/promises';

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

import { config } from '../config.js';

/**
 * WhatsApp transport via Baileys (WhatsApp Web protocol, no Meta Business account).
 *
 * Heads up: this drives a normal WhatsApp account, which is outside WhatsApp's
 * Terms of Service. It is the free option and fine for a personal bot, but the
 * account carries a real if small ban risk. Use a spare number if that matters.
 */

const RECONNECT_DELAY_MS = 3000;

export async function startWhatsApp({ onMessage, log }) {
  await mkdir(config.storage.authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.storage.authDir);
  const { version } = await fetchLatestBaileysVersion();

  let sock;
  let closed = false;

  function connect() {
    sock = makeWASocket({
      version,
      auth: state,
      // We print the QR ourselves so it renders in a VPS terminal.
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log.info('Scan this QR with WhatsApp → Linked devices');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') log.info('WhatsApp connected');

      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;

        if (loggedOut) {
          log.error('WhatsApp logged out — delete the auth dir and re-scan the QR');
          return;
        }
        if (closed) return;

        log.warn({ status }, 'WhatsApp connection closed, reconnecting');
        setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Ignore our own messages, status broadcasts, and group chats.
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

        const text =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          msg.message?.buttonsResponseMessage?.selectedButtonId ??
          msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ??
          '';
        if (!text) continue;

        try {
          await sock.readMessages([msg.key]);
          const reply = await onMessage(jid, text);
          // A handler can return one string or an array of strings to send as
          // separate message bubbles (e.g. a data result, then the menu).
          for (const part of [].concat(reply ?? [])) {
            if (part) await sock.sendMessage(jid, { text: part });
          }
        } catch (err) {
          log.error({ err: err.message, jid }, 'failed handling message');
          await sock
            .sendMessage(jid, { text: '⚠️ Something went wrong on my side. Try again in a moment.' })
            .catch(() => {});
        }
      }
    });
  }

  connect();

  return {
    /** Proactive send, used by alerts and the daily summary. */
    async send(jid, text) {
      if (!sock) throw new Error('WhatsApp socket not ready');
      await sock.sendMessage(jid, { text });
    },
    stop() {
      closed = true;
      sock?.end?.();
    },
  };
}
