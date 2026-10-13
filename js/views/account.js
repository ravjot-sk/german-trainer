// The account and sync card in Settings.
import * as sync from '../sync.js';
import { t } from '../i18n.js';
import { html, setHtml, replaceHtml, $, $$, errorBox, toast, inputAttrs } from '../ui/dom.js';
import { confirmSheet } from '../ui/sheet.js';
import { MAX_USES } from '../invites.js';
import { forgetResults } from '../ui/context.js';

const SIGNED_IN = ['synced', 'syncing', 'offline', 'error'];

export const accountSynced = () => SIGNED_IN.includes(sync.getState().status) && !!sync.getState().email;

const AUTH_ERRORS = {
  'auth/invalid-credential': 'credentials', 'auth/invalid-login-credentials': 'credentials',
  'auth/wrong-password': 'credentials', 'auth/user-not-found': 'credentials',
  'auth/email-already-in-use': 'inUse', 'auth/weak-password': 'weak',
  'auth/invalid-email': 'email', 'auth/missing-email': 'email',
  'auth/too-many-requests': 'tooMany', 'auth/network-request-failed': 'network',
  'invite/invalid': 'invite',
};

const syncError = (e) => (AUTH_ERRORS[e.code] ? t(`sync.err.${AUTH_ERRORS[e.code]}`) : e.message || String(e));

function syncStatusLine(st) {
  return html`<span class="muted" id="syncstatus">${t(`sync.status.${st.status}`, { n: st.pending, m: st.error })}</span>`;
}

// Runs a button's action with the button disabled; shows errors under the card.
function syncAction(id, fn) {
  $(`#${id}`)?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    btn.disabled = true;
    setHtml($('#syncres'), '');
    try { await fn(); } catch (err) { if ($('#syncres')) setHtml($('#syncres'), errorBox(syncError(err))); }
    finally { btn.disabled = false; }
  });
}

// Which version of the account card a state needs; the card is redrawn when this changes.
let shownSync = '';
let shownFailed = false;

const syncShape = (st) => (SIGNED_IN.includes(st.status) && st.email ? `in:${st.email}` : st.status);

export function renderSync() {
  const el = $('#synccard');
  if (!el) return;
  const st = sync.getState();
  shownSync = syncShape(st);
  shownFailed = st.inviteFailed;
  const res = html`<div id="syncres"></div>`;
  const signOutBtn = html`<button class="btn" id="ssignout">${t('sync.signOut')}</button>`;
  if (st.status === 'off') {
    setHtml(el, html`<p class="muted small">${t('sync.off')}</p>`);
  } else if (st.status === 'signedOut') {
    setHtml(el, html`
      <p class="muted small">${t('sync.help')}</p>
      <label>${t('sync.email')}<input id="semail" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>${t('sync.password')}<input id="spass" type="password" autocomplete="current-password"></label>
      <label>${t('sync.inviteOptional')}<input id="scode" ${inputAttrs} autocapitalize="characters" placeholder="ABCD2345"></label>
      <p class="muted small">${t('sync.inviteHelp')}</p>
      <div class="actions">
        <button class="btn primary" id="ssignin">${t('sync.signIn')}</button>
        <button class="btn" id="ssignup">${t('sync.signUp')}</button>
      </div>
      <button class="btn link" id="sforgot">${t('sync.forgot')}</button>
      ${res}`);
    const creds = () => {
      const email = $('#semail').value.trim();
      const pass = $('#spass').value;
      if (!email || !pass) throw new Error(t('sync.needEmail'));
      return [email, pass];
    };
    syncAction('ssignin', () => sync.signIn(...creds()));
    syncAction('ssignup', () => sync.signUp(...creds(), $('#scode').value));
    syncAction('sforgot', async () => {
      if (!$('#semail').value.trim()) throw new Error(t('sync.needEmail'));
      await sync.resetPassword($('#semail').value);
      setHtml($('#syncres'), html`<div class="notice ok">${t('sync.resetSent')}</div>`);
    });
  } else if (st.status === 'unverified') {
    setHtml(el, html`
      <p class="small">${t('sync.unverified', { e: st.email })}</p>
      <div class="actions">
        <button class="btn primary" id="sverified">${t('sync.verified')}</button>
        <button class="btn" id="sresend">${t('sync.resend')}</button>
      </div>
      ${signOutBtn}${res}`);
    syncAction('sverified', async () => {
      await sync.recheck();
      if (sync.getState().status === 'unverified') throw new Error(t('sync.stillUnverified'));
    });
    syncAction('sresend', async () => {
      await sync.resendVerification();
      setHtml($('#syncres'), html`<div class="notice ok">${t('sync.resent')}</div>`);
    });
  } else if (st.status === 'notInvited') {
    setHtml(el, html`
      <div class="notice">${t('sync.notInvited', { e: st.email })}</div>
      ${st.inviteFailed ? errorBox(t('sync.err.invite')) : ''}
      <label>${t('sync.invite')}<input id="scode" ${inputAttrs} autocapitalize="characters" placeholder="ABCD2345"></label>
      <button class="btn primary" id="sredeem">${t('sync.redeem')}</button>
      <div class="actions"><button class="btn" id="sretry">${t('sync.retry')}</button>${signOutBtn}</div>
      ${res}`);
    syncAction('sredeem', () => sync.redeemInvite($('#scode').value));
    syncAction('sretry', () => sync.recheck());
  } else if (!st.email) {
    // Still connecting, or offline before the account could be loaded.
    setHtml(el, html`<p class="small">${syncStatusLine(st)}</p>`);
  } else {
    setHtml(el, html`
      <p class="small">${t('sync.signedInAs', { e: st.email })}<br>${syncStatusLine(st)}</p>
      ${signOutBtn}
      <p class="muted small">${t('sync.signOutHelp')}</p>
      ${res}`);
  }
  syncAction('ssignout', async () => {
    let r = await sync.signOut();
    if (r.pending) {
      if (!(await confirmSheet(t('sync.confirmPending', { n: r.pending }), { ok: t('sync.signOut') }))) return;
      r = await sync.signOut({ force: true });
    }
    forgetResults();
  });
}

// While signed in, a status change only updates its line; anything else redraws the card.
export function showSyncState(st) {
  const line = $('#syncstatus');
  if (line && syncShape(st) === shownSync && st.inviteFailed === shownFailed) replaceHtml(line, syncStatusLine(st));
  else renderSync();
  if (st.admin !== shownAdmin) renderAdmin();
}

// ---------- invite codes, for admins ----------
let shownAdmin = false;

export function renderAdmin() {
  const el = $('#admincard');
  if (!el) return;
  shownAdmin = sync.getState().admin;
  if (!shownAdmin) { setHtml(el, ''); return; }
  setHtml(el, html`
    <div class="group-label">${t('invites.title')}</div>
    <section class="card form">
      <p class="muted small">${t('invites.help')}</p>
      <label>${t('invites.maxUses')}<input id="imax" type="number" inputmode="numeric" min="1" max="${MAX_USES}" value="1"></label>
      <button class="btn primary" id="inew">${t('invites.create')}</button>
      <div id="ires"></div>
    </section>
    <ul class="list" id="ilist"><li class="loading">…</li></ul>`);
  $('#inew').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setHtml($('#ires'), '');
    const n = Math.round(Number($('#imax').value));
    if (!(n >= 1 && n <= MAX_USES)) { setHtml($('#ires'), errorBox(t('invites.badMax', { n: MAX_USES }))); return; }
    btn.disabled = true;
    try {
      const code = await sync.createInvite(n);
      await copy(code);
      await loadInvites();
    } catch (err) { setHtml($('#ires'), errorBox(syncError(err))); }
    finally { btn.disabled = false; }
  });
  loadInvites();
}

async function loadInvites() {
  const list = $('#ilist');
  if (!list) return;
  let codes;
  try { codes = await sync.listInvites(); } catch (e) { setHtml(list, html`<li>${errorBox(syncError(e))}</li>`); return; }
  if (!$('#ilist')) return;
  setHtml(list, codes.length ? codes.map((c) => html`
    <li><span><b class="code">${c.code}</b><br><span class="muted small">${t(c.uses >= c.maxUses ? 'invites.usedUp' : 'invites.uses', { u: c.uses, m: c.maxUses })}</span></span>
      <span class="val"><button class="btn small text" data-copy="${c.code}">${t('invites.copy')}</button>
      <button class="btn small danger" data-del="${c.code}">${t('invites.delete')}</button></span></li>`)
    : html`<li class="muted small">${t('invites.none')}</li>`);
  $$('#ilist [data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  $$('#ilist [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmSheet(t('invites.confirmDelete', { c: b.dataset.del }), { ok: t('invites.delete') }))) return;
    b.disabled = true;
    try { await sync.deleteInvite(b.dataset.del); await loadInvites(); } catch (e) { b.disabled = false; toast(syncError(e)); }
  }));
}

async function copy(code) {
  try { await navigator.clipboard.writeText(code); toast(t('invites.copied', { c: code })); }
  catch { toast(code, 6000); }
}
