// AUR Desk — Settings → Privacy & Security.
// Everything about protecting the app and your data is gathered on this one page.
// Future privacy and security features go here too.
import { db } from '../db.js';
import { esc, icon, pageHeader, toast } from '../ui.js';
import { runLock, lockInfo, LOCK_TYPES, bioAvailable, bioEnabled, enableBio, disableBio } from './lock.js';
import { status as backupStatus } from '../backup.js';
import { changeBackupPassword } from '../settings.js';

export const AUTO_LOCK = { 0: 'Immediately', 30000: 'After 30 seconds', 60000: 'After 1 minute', 300000: 'After 5 minutes' };
export async function getAutoLockMs() {
  const v = await db.getKV('autoLockMs');
  return v == null ? 60000 : Number(v);
}

export async function renderSecurity(ctx, view) {
  const [info, bioOk, bioOn, autoMs, bk] = await Promise.all([lockInfo(), bioAvailable(), bioEnabled(), getAutoLockMs(), backupStatus()]);
  const lockLabel = info ? `${LOCK_TYPES[info.type].label} · ${info.length} ${info.type === 'digits' ? 'digits' : 'characters'}` : 'Not set';

  view.innerHTML = `
    ${pageHeader('Privacy & Security', 'Lock, fingerprint and backup password')}

    <section class="section">
      <div class="section-head"><h2>App lock</h2></div>
      <div class="card settings-list">
        <button class="set-row" data-change-lock>
          ${icon('lock')}<span class="set-text"><strong>Password</strong><small>${esc(lockLabel)}</small></span>${icon('right', 'row-arrow')}
        </button>
        ${bioOk ? `
        <label class="set-row">
          ${icon('finger')}<span class="set-text"><strong>Unlock with fingerprint</strong><small>Works with any password type</small></span>
          <input type="checkbox" class="switch" id="bio-toggle" ${bioOn ? 'checked' : ''}>
        </label>` : `<div class="set-row muted">${icon('finger')}<span>Fingerprint needs a screen lock on this phone</span></div>`}
        <div class="set-row">
          ${icon('clock')}
          <span class="set-text"><label for="auto-lock"><strong>Lock automatically</strong></label><small>When AUR Desk has been in the background</small></span>
          <select id="auto-lock" class="mini-select">
            ${Object.entries(AUTO_LOCK).map(([ms, l]) => `<option value="${ms}" ${Number(ms) === autoMs ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <button class="set-row" data-lock-now>${icon('lock')}<span class="set-text"><strong>Lock now</strong></span>${icon('right', 'row-arrow')}</button>
      </div>
      <p class="hint">Forgot your app password? The lock screen has "Forgot password?". It erases AUR Desk on this phone so you can restore your latest backup.</p>
    </section>

    <section class="section">
      <div class="section-head"><h2>Backups</h2></div>
      <div class="card settings-list">
        <button class="set-row" data-backup-pw>
          ${icon('key')}<span class="set-text"><strong>Backup password</strong><small>${bk.hasPassword ? 'Set · every backup is encrypted with it' : 'Not set yet'}</small></span>${icon('right', 'row-arrow')}
        </button>
      </div>
      <p class="hint">Without the backup password, your backups can't be opened by anyone, including you. Keep it written down somewhere safe.</p>
    </section>

    <section class="section">
      <div class="section-head"><h2>Where your data lives</h2></div>
      <div class="card privacy-facts">
        <p>${icon('check')}<span>Clients, prices, documents and money entries are stored only on this phone.</span></p>
        <p>${icon('check')}<span>Backups are encrypted on the phone before they go to your Google Drive.</span></p>
        <p>${icon('check')}<span>The app's code on GitHub holds no prices, clients or payment details.</span></p>
      </div>
    </section>
  `;

  view.querySelector('[data-change-lock]').onclick = async () => {
    await runLock(info ? 'change' : 'setup');
    toast('App lock updated');
    ctx.render();
  };
  const bio = view.querySelector('#bio-toggle');
  if (bio) bio.onchange = async () => {
    if (bio.checked) {
      try { await enableBio(); toast('Fingerprint unlock is on'); }
      catch { bio.checked = false; toast('Fingerprint was not set up'); }
    } else { await disableBio(); toast('Fingerprint unlock is off'); }
  };
  view.querySelector('#auto-lock').onchange = async (e) => {
    await db.setKV('autoLockMs', Number(e.target.value));
    await ctx.setAutoLock();
    toast('Locks ' + AUTO_LOCK[e.target.value].toLowerCase());
  };
  view.querySelector('[data-lock-now]').onclick = () => ctx.lockNow();
  view.querySelector('[data-backup-pw]').onclick = async () => { if (await changeBackupPassword(bk.hasPassword)) ctx.render(); };
}
