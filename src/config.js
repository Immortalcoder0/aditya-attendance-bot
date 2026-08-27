import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`env var ${name} must be an integer`);
  return n;
}

export const config = {
  portal: {
    origin: process.env.PORTAL_ORIGIN ?? 'https://info.aec.edu.in',
    profilePath: '/aus/Academics/StudentProfile.aspx?scrid=17',
    // Any request resets ASP.NET's sliding session expiry, so the keepalive can
    // hit the cheapest page available.
    keepAlivePath: '/aus/StudentMaster.aspx',
    requestTimeoutMs: int('PORTAL_TIMEOUT_MS', 20_000),
  },

  // ASP.NET sessions idle out; this site's exact timeout isn't published, so
  // poll conservatively often — keepalive is a cheap plain HTTP GET, not the
  // heavy browser render.
  keepAliveIntervalMs: int('KEEPALIVE_INTERVAL_MS', 3 * 60 * 1000),

  attendance: {
    target: Number(process.env.ATTENDANCE_TARGET ?? 0.75),
    // Don't re-alert on every poll for the same subject.
    alertCooldownMs: int('ALERT_COOLDOWN_MS', 12 * 60 * 60 * 1000),
  },

  schedule: {
    // node-cron expression + IANA zone for the daily summary.
    dailySummaryCron: process.env.DAILY_SUMMARY_CRON ?? '30 18 * * *',
    timezone: process.env.TZ_NAME ?? 'Asia/Kolkata',
  },

  storage: {
    dbPath: process.env.DB_PATH ?? './data/db.json',
    authDir: process.env.WA_AUTH_DIR ?? './data/wa-auth',
  },

  // 64 hex chars = 32 bytes for AES-256-GCM.
  encryptionKey: required('SESSION_ENCRYPTION_KEY'),

  logLevel: process.env.LOG_LEVEL ?? 'info',
};
