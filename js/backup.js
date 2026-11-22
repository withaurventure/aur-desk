// AUR Desk — password-protected backups to Google Drive, with auto-backup.
//
// • Every backup is encrypted on the phone (AES-256-GCM, key made from your backup password with
//   PBKDF2-SHA-256). Google only ever stores scrambled data. Without the password it cannot be read.
// • The app only sees files it created itself in Drive (scope "drive.file"), in a folder
//   called "AUR Desk Backups". It keeps the newest 10 and removes older ones.
// • Google keeps the app signed in for about an hour. Inside that hour, backups run silently.
//   After that, a due backup waits for one tap ("Back up now").
import { db } from './db.js';

const DATA_STORES = ['clients', 'rates', 'docs', 'txns'];
export const BACKUP_KEYS = ['profiles', 'owner', 'counters', 'profitPlan'];
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'AUR Desk Backups';
const KEEP = 10;
const ITER = 250000;

export const FREQS = {
  change: 'After every change',
  '1h': 'Every hour (while the app is open)',
  '2h': 'Every 2 hours (while the app is open)',
  '1d': 'Daily',
  '2d': 'Every 2 days',
  '7d': 'Weekly',
  '30d': 'Monthly',
  off: 'Off (only when I tap)',
};
const FREQ_MS = { '1h': 36e5, '2h': 72e5, '1d': 864e5, '2d': 1728e5, '7d': 6048e5, '30d': 2592e6 };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* =================== settings kept on the phone =================== */
export async function getPrefs() {
  return { freq: '1d', clientId: '', email: '', ...((await db.getKV('backupPrefs')) || {}) };
}
export async function setPrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  await db.setKV('backupPrefs', next);
  return next;
}
export async function status() {
  const [prefs, key, last, error, dirtySince] = await Promise.all([
    getPrefs(), db.getKV('backupKey'), db.getKV('lastDriveBackup'), db.getKV('lastDriveError'), db.getKV('dirtySince'),
  ]);
  return { prefs, hasPassword: !!key, last, error, dirtySince, connected: !!prefs.email, ready: !!(key && prefs.clientId && prefs.email) };
}

/* =================== encryption =================== */
async function deriveKey(password, salt, extractable = false) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt'],
  );
}

// The key is stored on this phone as a non-exportable key, so auto-backup needs no typing.
export async function setPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  await db.setKV('backupKey', { salt: b64(salt), key, setAt: new Date().toISOString() });
}

async function encryptPayload(payload) {
  const k = await db.getKV('backupKey');
  if (!k) throw new Error('no-password');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(JSON.stringify(payload)));
  return {
    app: 'aur-desk', kind: 'backup-encrypted', v: 1, exportedAt: payload.exportedAt,
    kdf: { name: 'PBKDF2-SHA256', iterations: ITER, salt: k.salt }, iv: b64(iv), data: b64(data),
  };
}

export async function decryptFile(file, password) {
  if (file.kind === 'backup') return file; // older, unencrypted backup
  if (file.kind !== 'backup-encrypted') throw new Error('not-backup');
  const key = await deriveKey(password, unb64(file.kdf.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
    return JSON.parse(dec.decode(plain));
  } catch { throw new Error('wrong-password'); }
}

/* =================== what goes into a backup =================== */
export async function buildPayload() {
  const out = { app: 'aur-desk', kind: 'backup', version: 2, exportedAt: new Date().toISOString() };
  for (const s of DATA_STORES) out[s] = await db.all(s);
  out.kv = Object.fromEntries(await Promise.all(BACKUP_KEYS.map(async (k) => [k, await db.getKV(k)])));
  return out;
}

export async function restorePayload(data) {
  for (const s of DATA_STORES) await db.clear(s);
  for (const s of DATA_STORES) for (const row of data[s] || []) await db.put(s, row);
  for (const k of BACKUP_KEYS) if (data.kv && k in data.kv) await db.setKV(k, data.kv[k]);
  await db.setKV('dirtySince', null);
}

export const summary = (d) => `${(d.clients || []).length} clients, ${(d.docs || []).length} documents, ${(d.txns || []).length} money entries, ${(d.rates || []).length} prices`;

/* =================== Google sign-in (Google Identity Services) =================== */
let gisPromise;
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error('offline')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}
// Load Google's sign-in script early, so a tap can open the sign-in window straight away.
export async function warmUp() {
  const p = await getPrefs();
  if (p.clientId && navigator.onLine) loadGis().catch(() => {});
}

async function savedToken() {
  const t = await db.getKV('driveToken');
  return t && t.expiresAt > Date.now() + 60000 ? t.token : null;
}

// interactive = true only when called from a tap (Google opens a small sign-in window)
async function getToken(interactive) {
  const cached = await savedToken();
  if (cached) return cached;
  if (!interactive) return null;
  const prefs = await getPrefs();
  if (!prefs.clientId) throw new Error('no-client-id');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: prefs.clientId,
      scope: SCOPE,
      hint: prefs.email || undefined,
      callback: async (resp) => {
        if (resp.error || !resp.access_token) { reject(new Error(resp.error || 'denied')); return; }
        await db.setKV('driveToken', { token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err && err.type === 'popup_closed' ? 'cancelled' : (err && err.type) || 'denied')),
    });
    client.requestAccessToken({ prompt: prefs.email ? '' : 'consent' });
  });
}

async function api(token, url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { await db.setKV('driveToken', null); throw new Error('expired'); }
  if (!res.ok) throw new Error(`drive-${res.status}`);
  return res;
}

/* =================== connect / disconnect =================== */
export async function connect() {
  const token = await getToken(true);
  const me = await (await api(token, 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')).json();
  const email = me.user && me.user.emailAddress;
  await setPrefs({ email });
  await folderId(token);
  return email;
}
export async function disconnect() {
  const t = await db.getKV('driveToken');
  if (t && t.token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t.token, () => {});
  await db.setKV('driveToken', null);
  await db.setKV('driveFolderId', null);
  await setPrefs({ email: '' });
}

async function folderId(token) {
  const saved = await db.getKV('driveFolderId');
  if (saved) {
    try {
      const f = await (await api(token, `https://www.googleapis.com/drive/v3/files/${saved}?fields=id,trashed`)).json();
      if (!f.trashed) return saved;
    } catch (e) { if (e.message === 'expired') throw e; }
  }
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  let id = found.files && found.files[0] && found.files[0].id;
  if (!id) {
    const made = await (await api(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    id = made.id;
  }
  await db.setKV('driveFolderId', id);
  return id;
}

/* =================== back up =================== */
let running = null;
export function backupToDrive({ interactive = false } = {}) {
  if (!running) running = doBackup(interactive).finally(() => { running = null; });
  return running;
}

async function doBackup(interactive) {
  const st = await status();
  if (!st.hasPassword) throw new Error('no-password');
  if (!st.prefs.clientId) throw new Error('no-client-id');
  const token = await getToken(interactive);
  if (!token) { announceDue(); throw new Error('needs-tap'); }
  try {
    const folder = await folderId(token);
    const payload = await buildPayload();
    const sealed = await encryptPayload(payload);
    const stamp = new Date();
    const name = `aur-desk-backup-${stamp.toLocaleDateString('en-CA')}-${stamp.toTimeString().slice(0, 5).replace(':', '')}.aurdesk`;
    const boundary = 'aurdesk' + Math.random().toString(36).slice(2);
    const meta = { name, parents: [folder], mimeType: 'application/octet-stream', description: `AUR Desk encrypted backup · ${summary(payload)}` };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${JSON.stringify(sealed)}\r\n--${boundary}--`;
    await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    await prune(token, folder);
    await db.setKV('lastDriveBackup', stamp.toISOString());
    await db.setKV('lastBackup', stamp.toISOString());
    await db.setKV('lastDriveError', null);
    await db.setKV('dirtySince', null);
    window.dispatchEvent(new CustomEvent('aurdesk:backup', { detail: { ok: true } }));
    return name;
  } catch (e) {
    await db.setKV('lastDriveError', { at: new Date().toISOString(), message: e.message });
    if (e.message === 'expired' && !interactive) announceDue();
    throw e;
  }
}

async function prune(token, folder) {
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
  const list = await (await api(token, `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id)&pageSize=100`)).json();
  for (const f of (list.files || []).slice(KEEP)) {
    await api(token, `https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

/* =================== restore =================== */
export async function listDriveBackups() {
  const token = await getToken(true);
  const folder = await folderId(token);
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
  const list = await (await api(token, `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,description)&pageSize=20`)).json();
  return list.files || [];
}
export async function downloadDriveBackup(id) {
  const token = await getToken(true);
  return (await api(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
}

// an encrypted copy on this phone, for when there's no internet
export async function encryptedFileForPhone() {
  const sealed = await encryptPayload(await buildPayload());
  return new File([JSON.stringify(sealed)], `aur-desk-backup-${new Date().toLocaleDateString('en-CA')}.aurdesk.txt`, { type: 'text/plain' });
}

/* =================== auto-backup =================== */
function announceDue() { window.dispatchEvent(new CustomEvent('aurdesk:backup-due')); }

export async function isDue() {
  const st = await status();
  if (!st.ready || st.prefs.freq === 'off') return false;
  if (st.prefs.freq === 'change') return !!st.dirtySince;
  const last = st.last ? new Date(st.last).getTime() : 0;
  // only when something changed since the last backup (no point uploading the same data again)
  return Date.now() - last >= FREQ_MS[st.prefs.freq] && (!!st.dirtySince || !st.last);
}

// Runs quietly. If Google needs a tap, Home shows "Back up now".
export async function autoBackup() {
  if (!navigator.onLine) return;
  try { if (await isDue()) await backupToDrive({ interactive: false }); }
  catch { /* shown in Settings and on Home */ }
}

let changeTimer;
let started = false;
export function startAutoBackup() {
  if (started) return;
  started = true;
  // something changed → remember it; with "After every change", back up 20 s after the last edit
  window.addEventListener('aurdesk:changed', async () => {
    if (!(await db.getKV('dirtySince'))) await db.setKV('dirtySince', new Date().toISOString());
    clearTimeout(changeTimer);
    changeTimer = setTimeout(autoBackup, 20000);
  });
  setInterval(() => { if (!document.hidden) autoBackup(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) autoBackup(); });
  window.addEventListener('online', autoBackup);
  autoBackup();
}

/* =================== messages people can read =================== */
export function explain(err) {
  const m = (err && err.message) || String(err);
  return ({
    'no-password': 'Set a backup password first.',
    'no-client-id': 'Paste your Google Client ID first (see the setup steps).',
    cancelled: 'Google sign-in was closed before finishing.',
    denied: 'Google did not allow access. Try again and tap Allow / Continue.',
    access_denied: 'Google did not allow access. Check that this account is added as a test user.',
    popup_failed_to_open: 'The Google window was blocked. Tap the button again.',
    offline: "You're offline. Connect to the internet and try again.",
    expired: 'Google sign-in expired. Tap Back up now.',
    'needs-tap': 'Google needs a quick tap to sign in again.',
    'wrong-password': "That password doesn't open this backup.",
  })[m] || (m.startsWith('drive-') ? `Google Drive said no (${m.slice(6)}). Try again in a minute.` : 'Something went wrong: ' + m);
}
