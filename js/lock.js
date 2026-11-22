// AUR Desk — PIN and fingerprint lock.
// The PIN is never stored: only a salted, slow hash of it. Fingerprint uses Android's
// own screen-lock check (WebAuthn); the fingerprint itself never reaches the app.
import { db } from './db.js';
import { esc, icon, confirmBox } from './ui.js';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

export async function hasPin() { return !!(await db.getKV('pin')); }
async function setPin(pin) {
  const salt = rand(16);
  await db.setKV('pin', { salt: b64(salt), hash: await hashPin(pin, salt) });
}
async function checkPin(pin) {
  const p = await db.getKV('pin');
  return !!p && (await hashPin(pin, unb64(p.salt))) === p.hash;
}

/* ---------- fingerprint ---------- */
export async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}
export async function bioEnabled() { return !!(await db.getKV('bio')); }
export async function enableBio() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'AUR Desk' },
      user: { id: rand(16), name: 'aur-desk-owner', displayName: 'AUR Desk' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  await db.setKV('bio', { id: b64(cred.rawId) });
}
export async function disableBio() { await db.setKV('bio', null); }
async function bioUnlock() {
  const b = await db.getKV('bio');
  if (!b) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: unb64(b.id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch { return false; }
}

/* ---------- lock screen ----------
   mode 'unlock': ask for PIN (or fingerprint), resolve when correct.
   mode 'setup':  create + confirm a new PIN, then offer fingerprint. */
export function runLock(mode = 'unlock', { cancellable = false } = {}) {
  const el = document.getElementById('lock');
  let stage = mode === 'setup' ? 'create' : 'unlock';
  let entry = '';
  let first = '';
  let fails = 0;
  let blockedUntil = 0;
  let busy = false;
  let useBio = false;

  return new Promise(async (resolve) => {
    useBio = stage === 'unlock' && (await bioEnabled());

    const titles = {
      create: ['Create a 4-digit PIN', 'You will use it every time you open AUR Desk.'],
      confirm: ['Enter the PIN again', 'Just to make sure.'],
      unlock: ['Enter your PIN', useBio ? 'Or use your fingerprint.' : ''],
    };

    function done() {
      el.hidden = true;
      el.innerHTML = '';
      document.body.classList.remove('locked');
      resolve();
    }

    function draw(msg = '', bad = false) {
      const [t, sub] = titles[stage];
      const dots = [0, 1, 2, 3].map((i) => `<span class="pin-dot${i < entry.length ? ' on' : ''}"></span>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      el.innerHTML = `
        <div class="lock-top">
          <img src="icons/icon-192.png" alt="" class="lock-logo">
          <h1 class="lock-title">${esc(t)}</h1>
          <p class="lock-sub">${esc(sub)}</p>
          <div class="pin-dots${bad ? ' shake' : ''}" aria-label="${entry.length} of 4 digits entered">${dots}</div>
          <p class="lock-msg" role="alert">${esc(msg)}</p>
        </div>
        <div class="keypad">
          ${keys.map((k) => `<button class="key" data-key="${k}">${k}</button>`).join('')}
          ${useBio && stage === 'unlock'
            ? `<button class="key key-icon" data-bio aria-label="Unlock with fingerprint">${icon('finger')}</button>`
            : '<span></span>'}
          <button class="key" data-key="0">0</button>
          <button class="key key-icon" data-del aria-label="Delete last digit">${icon('del')}</button>
        </div>
        ${stage === 'unlock' ? '<button class="link-btn" data-forgot>Forgot PIN?</button>' : (cancellable ? '<button class="link-btn" data-cancel>Cancel</button>' : '')}`;
    }

    async function offerBio() {
      if (!(await bioAvailable())) return done();
      el.innerHTML = `
        <div class="lock-top">
          <div class="bio-badge">${icon('finger')}</div>
          <h1 class="lock-title">Unlock with fingerprint?</h1>
          <p class="lock-sub">Use your phone's fingerprint instead of typing the PIN. The PIN still works as a backup.</p>
        </div>
        <div class="lock-actions">
          <button class="btn btn-primary" data-bio-yes>Use fingerprint</button>
          <button class="btn btn-ghost" data-bio-no>Not now</button>
        </div>`;
    }

    async function submit() {
      busy = true;
      if (stage === 'create') {
        first = entry; entry = ''; stage = 'confirm'; draw();
      } else if (stage === 'confirm') {
        if (entry === first) { await setPin(entry); busy = false; return offerBio(); }
        entry = ''; first = ''; stage = 'create'; draw("The PINs didn't match. Try again.", true);
      } else {
        if (Date.now() < blockedUntil) { entry = ''; draw('Too many tries. Wait a few seconds.', true); }
        else if (await checkPin(entry)) { busy = false; return done(); }
        else {
          fails += 1; entry = '';
          if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; draw('Too many tries. Wait 30 seconds.', true); }
          else draw('Wrong PIN', true);
        }
      }
      busy = false;
    }

    async function tryBio() {
      if (await bioUnlock()) done();
    }

    el.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b || busy) return;
      if (b.dataset.key && entry.length < 4) {
        entry += b.dataset.key;
        draw();
        if (entry.length === 4) setTimeout(submit, 120);
      } else if ('del' in b.dataset) {
        entry = entry.slice(0, -1); draw();
      } else if ('bio' in b.dataset) {
        tryBio();
      } else if ('bioYes' in b.dataset) {
        try { await enableBio(); done(); } catch { done(); }
      } else if ('bioNo' in b.dataset) {
        done();
      } else if ('cancel' in b.dataset) {
        done();
      } else if ('forgot' in b.dataset) {
        const ok = await confirmBox({
          title: 'Reset AUR Desk?',
          text: 'Without the PIN, the only way in is to erase everything AUR Desk has stored on this phone. You can then restore your latest backup file.',
          ok: 'Erase and reset',
          danger: true,
        });
        if (ok) { await db.wipe(); localStorage.clear(); location.reload(); }
      }
    };

    document.body.classList.add('locked');
    el.hidden = false;
    draw();
    if (useBio) setTimeout(tryBio, 300);
  });
}
