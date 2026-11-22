// AUR Desk — app lock: password (numbers, letters, or letters + numbers) and fingerprint.
// Part of the Privacy & Security folder: everything about locking and protecting the app lives here.
//
// • The password is never stored, only a salted, slow hash (PBKDF2-SHA-256, 150,000 rounds).
// • Letters are case-sensitive.
// • Fingerprint uses Android's own screen-lock check (WebAuthn); the fingerprint never reaches the app.
// • A 4-digit PIN from older versions keeps working until you change it.
import { db } from '../db.js';
import { esc, icon, confirmBox } from '../ui.js';

export const LOCK_TYPES = {
  digits: { label: 'Numbers only', min: 4, max: 8, hint: '4 to 8 digits' },
  letters: { label: 'Letters only', min: 6, max: 8, hint: '6 to 8 letters, capitals count' },
  mixed: { label: 'Letters and numbers', min: 6, max: 8, hint: '6 to 8 characters, at least one letter and one number' },
};

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
export async function lockInfo() {
  const p = await db.getKV('pin');
  if (!p) return null;
  return { type: p.type || 'digits', length: p.length || 4 };
}
async function setPin(pin, type) {
  const salt = rand(16);
  await db.setKV('pin', { salt: b64(salt), hash: await hashPin(pin, salt), type, length: pin.length });
}
async function checkPin(pin) {
  const p = await db.getKV('pin');
  return !!p && (await hashPin(pin, unb64(p.salt))) === p.hash;
}

export function validate(type, value) {
  const t = LOCK_TYPES[type];
  if (value.length < t.min || value.length > t.max) return `Use ${t.hint}.`;
  if (type === 'digits' && !/^\d+$/.test(value)) return 'Numbers only, please.';
  if (type === 'letters' && !/^[A-Za-z]+$/.test(value)) return 'Letters only (A–Z), no numbers or symbols.';
  if (type === 'mixed') {
    if (!/^[A-Za-z0-9]+$/.test(value)) return 'Letters and numbers only, no symbols or spaces.';
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Use at least one letter and one number.';
  }
  return '';
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

/* ---------- the lock screen ----------
   mode 'unlock': ask for the password (or fingerprint).
   mode 'setup':  first time — choose a type, create it, confirm it, offer fingerprint.
   mode 'change': confirm the current password, then the same as setup. Can be cancelled. */
export function runLock(mode = 'unlock') {
  const el = document.getElementById('lock');
  return new Promise(async (resolve) => {
    const info = await lockInfo();
    const useBio = await bioEnabled();
    let stage = mode === 'setup' ? 'type' : mode === 'change' ? 'verify' : 'unlock';
    let type = info ? info.type : 'digits';      // the type being entered right now
    let newType = 'digits';                      // the type being created
    let entry = '';
    let first = '';
    let fails = 0;
    let blockedUntil = 0;
    let busy = false;
    const cancellable = mode === 'change';

    const done = () => {
      el.hidden = true;
      el.innerHTML = '';
      document.body.classList.remove('locked');
      resolve();
    };

    // what is being typed at this stage, and how long it may be
    const current = () => {
      if (stage === 'unlock' || stage === 'verify') return { kind: type, fixed: info ? info.length : 4 };
      return { kind: newType, fixed: stage === 'confirm' ? first.length : 0 };
    };

    const titles = () => ({
      unlock: ['Enter your password', useBio ? 'Or use your fingerprint' : ''],
      verify: ['Enter your current password', 'To change how AUR Desk is locked'],
      type: ['Choose your lock type', 'You can change this later in Privacy & Security'],
      create: ['Create your password', LOCK_TYPES[newType].hint],
      confirm: ['Enter it again', 'Just to make sure'],
    })[stage];

    function footer() {
      if (stage === 'unlock') return '<button class="link-btn" data-forgot>Forgot password?</button>';
      if (cancellable) return '<button class="link-btn" data-cancel>Cancel</button>';
      if (stage === 'create' || stage === 'confirm') return '<button class="link-btn" data-retype>Choose another type</button>';
      return '';
    }

    function draw(msg = '', bad = false) {
      const [t, sub] = titles();
      const top = `
        <div class="lock-top">
          <svg class="lock-mark" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,16 50,44 34,72 20,72" fill="#D99A2E"></polygon><polygon points="50,16 80,72 66,72 50,44" fill="#F4BE5A"></polygon><polygon points="50,54 60,72 40,72" fill="#F0B448"></polygon><rect x="28" y="79" width="44" height="5" rx="2.5" fill="#F0B448"></rect></svg>
          <h1 class="lock-title">${esc(t)}</h1>
          <p class="lock-sub">${esc(sub)}</p>`;

      if (stage === 'type') {
        el.innerHTML = `${top}</div>
          <div class="lock-types" role="radiogroup" aria-label="Lock type">
            ${Object.entries(LOCK_TYPES).map(([k, v]) => `
              <button class="lock-type" data-type="${k}">
                <strong>${esc(v.label)}</strong><small>${esc(v.hint)}</small>
              </button>`).join('')}
          </div>
          <div class="lock-foot">${footer()}</div>`;
        return;
      }

      const { kind, fixed } = current();
      const max = LOCK_TYPES[kind].max;
      if (kind === 'digits') {
        const count = fixed || Math.max(LOCK_TYPES.digits.min, entry.length);
        const dots = Array.from({ length: fixed ? fixed : max }, (_, i) =>
          `<span class="pin-dot${i < entry.length ? ' on' : ''}${!fixed && i >= count ? ' optional' : ''}"></span>`).join('');
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const left = stage === 'unlock' && useBio
          ? `<button class="key key-icon" data-bio aria-label="Unlock with fingerprint">${icon('finger')}</button>`
          : (!fixed ? `<button class="key key-text" data-done ${entry.length >= LOCK_TYPES.digits.min ? '' : 'disabled'}>Done</button>` : '<span></span>');
        el.innerHTML = `${top}
            <div class="pin-dots${bad ? ' shake' : ''}" aria-label="${entry.length} digits entered">${dots}</div>
            <p class="lock-msg" role="alert">${esc(msg)}</p>
          </div>
          <div class="keypad">
            ${keys.map((k) => `<button class="key" data-key="${k}">${k}</button>`).join('')}
            ${left}
            <button class="key" data-key="0">0</button>
            <button class="key key-icon" data-del aria-label="Delete last digit">${icon('del')}</button>
          </div>
          <div class="lock-foot">${footer()}</div>`;
      } else {
        el.innerHTML = `${top}
            <form class="lock-form${bad ? ' shake' : ''}" id="lock-form" novalidate>
              <label class="sr-only" for="lock-input">${esc(t)}</label>
              <div class="lock-input-wrap">
                <input id="lock-input" type="password" maxlength="${max}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" value="">
                <button type="button" class="lock-eye" data-eye aria-label="Show password">${icon('eye')}</button>
              </div>
              <p class="lock-msg" role="alert">${esc(msg)}</p>
              <div class="lock-actions-row">
                ${stage === 'unlock' && useBio ? `<button type="button" class="key key-icon key-sm" data-bio aria-label="Unlock with fingerprint">${icon('finger')}</button>` : ''}
                <button class="btn lock-go" type="submit">${stage === 'unlock' ? 'Unlock' : stage === 'verify' ? 'Continue' : stage === 'confirm' ? 'Confirm' : 'Next'}</button>
              </div>
            </form>
          </div>
          <div class="lock-foot">${footer()}</div>`;
        const input = el.querySelector('#lock-input');
        setTimeout(() => input.focus(), 50);
        el.querySelector('#lock-form').onsubmit = (e) => { e.preventDefault(); entry = input.value; submit(); };
      }
    }

    async function offerBio() {
      if (useBio || !(await bioAvailable())) return done();
      el.innerHTML = `
        <div class="lock-top">
          <div class="bio-badge">${icon('finger')}</div>
          <h1 class="lock-title">Unlock with fingerprint?</h1>
          <p class="lock-sub">Use your fingerprint instead of typing. Your password still works as a backup.</p>
        </div>
        <div class="lock-actions">
          <button class="btn btn-primary" data-bio-yes>Use fingerprint</button>
          <button class="btn btn-ghost" data-bio-no>Not now</button>
        </div>`;
    }

    async function submit() {
      if (busy) return;
      busy = true;
      try {
        if (stage === 'unlock' || stage === 'verify') {
          if (Date.now() < blockedUntil) { entry = ''; draw('Too many tries. Wait a few seconds.', true); return; }
          if (await checkPin(entry)) {
            entry = '';
            if (stage === 'unlock') return done();
            stage = 'type'; draw(); return;
          }
          fails += 1; entry = '';
          if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; draw('Too many tries. Wait 30 seconds.', true); }
          else draw('Wrong password', true);
        } else if (stage === 'create') {
          const problem = validate(newType, entry);
          if (problem) { entry = ''; draw(problem, true); return; }
          first = entry; entry = ''; stage = 'confirm'; draw();
        } else if (stage === 'confirm') {
          if (entry === first) {
            await setPin(entry, newType);
            entry = ''; first = '';
            if (mode === 'change') return done();
            return offerBio();
          }
          entry = ''; first = ''; stage = 'create'; draw("They didn't match. Try again.", true);
        }
      } finally { busy = false; }
    }

    el.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b || busy) return;
      const { kind, fixed } = stage === 'type' ? { kind: null, fixed: 0 } : current();
      if (b.dataset.type) {
        newType = b.dataset.type; stage = 'create'; entry = ''; draw();
      } else if (b.dataset.key && kind === 'digits' && entry.length < (fixed || LOCK_TYPES.digits.max)) {
        entry += b.dataset.key;
        draw();
        if (fixed && entry.length === fixed) setTimeout(submit, 120);
      } else if ('del' in b.dataset) {
        entry = entry.slice(0, -1); draw();
      } else if ('done' in b.dataset) {
        submit();
      } else if ('eye' in b.dataset) {
        const input = el.querySelector('#lock-input');
        input.type = input.type === 'password' ? 'text' : 'password';
        b.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
        input.focus();
      } else if ('bio' in b.dataset) {
        if (await bioUnlock()) done();
      } else if ('bioYes' in b.dataset) {
        try { await enableBio(); } catch { /* not set up */ }
        done();
      } else if ('bioNo' in b.dataset || 'cancel' in b.dataset) {
        done();
      } else if ('retype' in b.dataset) {
        stage = 'type'; entry = ''; first = ''; draw();
      } else if ('forgot' in b.dataset) {
        const ok = await confirmBox({
          title: 'Reset AUR Desk?',
          text: 'Without the password, the only way in is to erase everything AUR Desk has stored on this phone. You can then restore your latest backup from Google Drive.',
          ok: 'Erase and reset',
          danger: true,
        });
        if (ok) { await db.wipe(); localStorage.clear(); sessionStorage.clear(); location.reload(); }
      }
    };

    document.body.classList.add('locked');
    setThemeColor('#0A1433');
    el.hidden = false;
    draw();
    if (stage === 'unlock' && useBio) setTimeout(async () => { if (await bioUnlock()) done(); }, 300);
  });
}

// status-bar colour: navy while locked or launching, light while using the app
export function setThemeColor(hex) {
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', hex);
}
