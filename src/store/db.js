import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { JSONFilePreset } from 'lowdb/node';

import { config } from '../config.js';
import { createCryptoBox, randomUUID } from './crypto.js';

/**
 * Persistence for linked students.
 *
 * The only secret held here is the Campus Connect session cookie, encrypted at
 * rest — nothing else. No password is ever stored: sessions can only come from
 * a human logging in themselves (see session.js for why).
 */

const DEFAULT_DATA = { users: [] };

export async function openStore() {
  await mkdir(dirname(config.storage.dbPath), { recursive: true });
  const db = await JSONFilePreset(config.storage.dbPath, DEFAULT_DATA);
  const box = createCryptoBox(config.encryptionKey);

  const findUser = (waJid) => db.data.users.find((u) => u.waJid === waJid) ?? null;

  return {
    get users() {
      return db.data.users;
    },

    /** Users that currently hold a session (may or may not still be alive). */
    linkedUsers() {
      return db.data.users.filter((u) => u.session);
    },

    getUser: findUser,

    async ensureUser(waJid) {
      let user = findUser(waJid);
      if (!user) {
        user = {
          id: randomUUID(),
          waJid,
          session: null,
          sessionLinkedAt: null,
          target: config.attendance.target,
          lastSnapshot: null,
          lastAlertAt: {},
          dailySummary: true,
          createdAt: new Date().toISOString(),
        };
        db.data.users.push(user);
        await db.write();
      }
      return user;
    },

    /** Store a freshly captured cookie header, encrypted. */
    async setSession(waJid, cookieHeader) {
      const user = await this.ensureUser(waJid);
      user.session = box.encrypt(cookieHeader);
      user.sessionLinkedAt = new Date().toISOString();
      await db.write();
      return user;
    },

    /** @returns {string|null} decrypted cookie header */
    getSession(waJid) {
      const user = findUser(waJid);
      if (!user?.session) return null;
      try {
        return box.decrypt(user.session);
      } catch {
        // Key rotated or record tampered with — treat as unlinked rather than crash.
        return null;
      }
    },

    async clearSession(waJid) {
      const user = findUser(waJid);
      if (!user) return;
      user.session = null;
      user.sessionLinkedAt = null;
      await db.write();
    },

    /** Full erasure for the "unlink me" command. */
    async forgetUser(waJid) {
      const before = db.data.users.length;
      db.data.users = db.data.users.filter((u) => u.waJid !== waJid);
      await db.write();
      return db.data.users.length < before;
    },

    async updateUser(waJid, patch) {
      const user = await this.ensureUser(waJid);
      Object.assign(user, patch);
      await db.write();
      return user;
    },

    async saveSnapshot(waJid, attendance) {
      const user = findUser(waJid);
      if (!user) return;
      user.lastSnapshot = attendance;
      await db.write();
    },
  };
}
