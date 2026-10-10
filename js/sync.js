// Account sync with Firebase (Auth + Firestore). The app stays local-first: localStorage
// is what the app reads and writes, and this module mirrors it to
// users/{uid}/{collection}/{id} in Firestore and merges other devices' changes back in
// (rules in syncmerge.js). Access is invite-only and private, enforced by firestore.rules:
// the owner adds someone's email to the allowlist, or they redeem an invite code.
// The Firebase SDK is loaded on demand, so the app still starts offline or without config.
import * as store from './store.js';
import { firebaseConfig } from './firebase-config.js';
import { COLLECTIONS, pendingChanges, applyRemote, docId, recId } from './syncmerge.js';
import { newCode, normCode, isCode } from './invites.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const STATE_KEY = 'gt.sync.v1';
// A code entered when creating the account, used once the email is confirmed.
const INVITE_KEY = 'gt.sync.invite';
const BATCH = 400;
// On restart, re-read the last minute too, in case server times landed slightly out of order.
const OVERLAP = 60e3;

let A = null; // firebase/auth
let F = null; // firebase/firestore
let auth = null;
let db = null;
let user = null;
let status = firebaseConfig ? 'loading' : 'off';
let lastError = '';
let admin = false; // may create invite codes
let inviteFailed = false; // the code from sign-up didn't work
let live = false; // listeners running and uploads allowed
let unsubs = [];
let inflight = {};
let flushing = null;
let again = false;
let timer = null;
let loading = null;
// { uid, cursor: { coll: ms }, synced: { coll: { id: updatedAt } } }. The uid also marks
// whose account the local data belongs to.
let sync = loadState();
const listeners = new Set();

function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch { return null; }
}
function saveState() {
  if (sync) localStorage.setItem(STATE_KEY, JSON.stringify(sync)); else localStorage.removeItem(STATE_KEY);
}

export const enabled = () => !!firebaseConfig;

function countPending() {
  if (!sync) return 0;
  const { ups, dels } = pendingChanges(store.rawData(), sync.synced);
  return ups.length + dels.length;
}

export function getState() {
  return { status, email: user?.email || '', error: lastError, pending: live ? countPending() : 0, admin, inviteFailed };
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const notify = () => listeners.forEach((fn) => fn(getState()));

function setStatus(s) {
  if (s === status) return;
  status = s;
  notify();
}

function setAdmin(a) {
  if (a === admin) return;
  admin = a;
  notify();
}

const pendingCode = () => { try { return localStorage.getItem(INVITE_KEY) || ''; } catch { return ''; } };
function setPendingCode(code) {
  try { if (code) localStorage.setItem(INVITE_KEY, code); else localStorage.removeItem(INVITE_KEY); } catch { /* not kept */ }
}

// While syncing, the status follows the connection, the upload queue and the last error.
function refresh() {
  if (!live) return;
  if (navigator.onLine === false) setStatus('offline');
  else if (lastError) setStatus('error');
  else setStatus(flushing || countPending() ? 'syncing' : 'synced');
}

// ---------- startup ----------
export function init() {
  if (!firebaseConfig) return Promise.resolve();
  return (loading ||= load());
}

async function load() {
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    A = authM;
    F = fsM;
    const app = appM.initializeApp(firebaseConfig);
    // No popup/redirect resolver: email sign-in only, which works inside a home-screen app.
    auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
    const emu = firebaseConfig.emulators; // local testing only
    if (emu) {
      A.connectAuthEmulator(auth, emu.auth, { disableWarnings: true });
      F.connectFirestoreEmulator(db, emu.firestoreHost, emu.firestorePort);
    }
  } catch (e) {
    // Most likely offline at launch. Try again once the connection is back.
    console.warn('sync unavailable', e);
    loading = null;
    setStatus('offline');
    window.addEventListener('online', init, { once: true });
    return;
  }
  store.onChange(({ remote } = {}) => { if (!remote) scheduleFlush(); });
  window.addEventListener('online', () => { if (status === 'error' && !live) check(); else { scheduleFlush(0); refresh(); } });
  window.addEventListener('offline', refresh);
  A.onAuthStateChanged(auth, (u) => { user = u; check(); });
}

async function check() {
  stop();
  if (!user) { setAdmin(false); return setStatus('signedOut'); }
  if (!user.emailVerified) return setStatus('unverified');
  setStatus('loading');
  checkAdmin();
  try {
    const snap = await F.getDoc(F.doc(db, 'allowlist', user.email.toLowerCase()));
    if (!snap.exists()) return notInvited();
  } catch (e) {
    if (e.code === 'permission-denied') return notInvited();
    // Offline: a device that already syncs this account carries on from its local data.
    if (sync?.uid !== user.uid) { lastError = e.message; return setStatus('error'); }
  }
  start();
}

// Not on the allowlist (yet): use the code from sign-up, if there was one.
async function notInvited() {
  const code = pendingCode();
  if (code) {
    try {
      await joinWith(code);
      setPendingCode('');
      inviteFailed = false;
      return start();
    } catch (e) {
      console.warn('invite code failed', e);
      if (badCode(e)) { setPendingCode(''); inviteFailed = true; }
    }
  }
  setStatus('notInvited');
}

// The rules refuse a code that doesn't exist or has no uses left.
const badCode = (e) => e.code === 'permission-denied' || e.code === 'not-found';

// Adds this account to the allowlist and uses up one use of the code, both or neither.
async function joinWith(code) {
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, 'allowlist', user.email.toLowerCase()), { code, uid: user.uid, joinedAt: F.serverTimestamp() });
  batch.update(F.doc(db, 'inviteCodes', code), { uses: F.increment(1) });
  await batch.commit();
}

async function checkAdmin() {
  const uid = user.uid;
  let a = false;
  try { a = (await F.getDoc(F.doc(db, 'admins', uid))).exists(); } catch { /* not an admin, or offline */ }
  if (user?.uid === uid) setAdmin(a);
}

function start() {
  if (sync?.uid !== user.uid) {
    // Data from a different account should never be here (signing out clears it), but if it
    // is, don't upload it into this one.
    if (sync) store.resetData();
    // With no account recorded, the local data was made before signing in: it is uploaded
    // into this account by the first flush, because nothing in it is marked as synced.
    sync = { uid: user.uid, cursor: {}, synced: {} };
    saveState();
  }
  live = true;
  lastError = '';
  inflight = {};
  for (const coll of COLLECTIONS) {
    const since = Math.max(0, (sync.cursor[coll] || 0) - OVERLAP);
    const q = F.query(F.collection(db, 'users', user.uid, coll), F.where('syncedAt', '>', F.Timestamp.fromMillis(since)));
    unsubs.push(F.onSnapshot(q, (snap) => onSnap(coll, snap), onListenError));
  }
  scheduleFlush(0);
  refresh();
}

function stop() {
  live = false;
  unsubs.forEach((u) => u());
  unsubs = [];
  clearTimeout(timer);
}

function onSnap(coll, snap) {
  if (!live) return;
  const docs = [];
  let max = sync.cursor[coll] || 0;
  for (const ch of snap.docChanges()) {
    // Our own writes come back once the server has them; skip the optimistic copy.
    if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) continue;
    const d = ch.doc.data();
    const at = d.syncedAt?.toMillis?.() || 0;
    if (at > max) max = at;
    docs.push({ ...d, id: recId(ch.doc.id) });
  }
  sync.cursor[coll] = max;
  if (docs.length && applyRemote(store.rawData(), sync.synced, coll, docs)) store.commitRemote();
  saveState();
  // Merging can leave something to send back (a duplicate to tombstone, a newer local copy).
  scheduleFlush();
  refresh();
}

function onListenError(e) {
  console.warn('sync listen failed', e);
  stop();
  if (e.code === 'permission-denied') return setStatus('notInvited');
  lastError = e.message;
  setStatus('error');
}

// ---------- uploads ----------
function scheduleFlush(ms = 1500) {
  if (!live) return;
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

async function flush() {
  if (!live) return;
  if (flushing) { again = true; return flushing; }
  flushing = upload();
  refresh();
  try {
    await flushing;
    lastError = '';
  } catch (e) {
    console.warn('sync upload failed', e);
    lastError = e.message;
    if (e.code === 'permission-denied') { stop(); setStatus('notInvited'); }
    else scheduleFlush(30e3);
  } finally {
    flushing = null;
    if (again) { again = false; scheduleFlush(0); }
    refresh();
  }
}

async function upload() {
  const uid = user.uid;
  const { ups, dels } = pendingChanges(store.rawData(), sync.synced, inflight);
  const ops = [
    ...ups.map((u) => ({ coll: u.coll, id: u.rec.id, rec: u.rec, t: u.t })),
    ...dels.map((d) => ({ coll: d.coll, id: d.id, t: 'del' })),
  ];
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    const batch = F.writeBatch(db);
    for (const op of chunk) {
      const ref = F.doc(db, 'users', uid, op.coll, docId(op.id));
      inflight[`${op.coll}/${op.id}`] = op.t;
      if (op.t === 'del') batch.set(ref, { deleted: true, updatedAt: Date.now(), syncedAt: F.serverTimestamp() });
      else batch.set(ref, { ...op.rec, updatedAt: op.t, syncedAt: F.serverTimestamp() });
    }
    try {
      // Resolves once the server has the writes; while offline it waits for the connection.
      await batch.commit();
    } finally {
      for (const op of chunk) delete inflight[`${op.coll}/${op.id}`];
    }
    if (!live || sync?.uid !== uid) return;
    for (const op of chunk) {
      const seen = (sync.synced[op.coll] ||= {});
      if (op.t === 'del') delete seen[op.id];
      else if (!(seen[op.id] >= op.t)) seen[op.id] = op.t;
    }
    saveState();
  }
}

// ---------- bug reports ----------
// Reports need an invited, signed-in account: firestore.rules lets such users create a report
// in bugReports and nobody read one from the app.
export const canReport = () => live && !!user;

export async function sendReport(report) {
  if (!canReport()) throw new Error('not signed in');
  await F.addDoc(F.collection(db, 'bugReports'), { ...report, uid: user.uid, createdAt: F.serverTimestamp() });
}

// ---------- account actions (errors are Firebase errors with a .code) ----------
const norm = (email) => email.trim().toLowerCase();

export async function signIn(email, password) {
  await init();
  await A.signInWithEmailAndPassword(auth, norm(email), password);
}

// An invite code is optional; it's kept until the email is confirmed and then used.
export async function signUp(email, password, invite = '') {
  const code = normCode(invite);
  if (code && !isCode(code)) throw inviteError();
  await init();
  setPendingCode(code);
  inviteFailed = false;
  const cred = await A.createUserWithEmailAndPassword(auth, norm(email), password);
  await A.sendEmailVerification(cred.user);
}

export async function resendVerification() {
  await A.sendEmailVerification(auth.currentUser);
}

// After the user taps the link in the verification email.
export async function recheck() {
  if (!auth.currentUser) return;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true); // so the rules see email_verified
  user = auth.currentUser;
  await check();
}

function inviteError() {
  return Object.assign(new Error('invalid invite code'), { code: 'invite/invalid' });
}

// From the "not invited" card: join with a code now.
export async function redeemInvite(invite) {
  const code = normCode(invite);
  if (!isCode(code)) throw inviteError();
  try {
    await joinWith(code);
  } catch (e) {
    throw badCode(e) ? inviteError() : e;
  }
  inviteFailed = false;
  await check();
}

// ---------- invite codes (admins only, enforced by the rules) ----------
export async function listInvites() {
  const snap = await F.getDocs(F.query(F.collection(db, 'inviteCodes'), F.orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ code: d.id, uses: d.data().uses || 0, maxUses: d.data().maxUses || 0 }));
}

export async function createInvite(maxUses) {
  const code = newCode();
  await F.setDoc(F.doc(db, 'inviteCodes', code), { maxUses, uses: 0, createdAt: F.serverTimestamp() });
  return code;
}

export async function deleteInvite(code) {
  await F.deleteDoc(F.doc(db, 'inviteCodes', code));
}

export async function resetPassword(email) {
  await init();
  await A.sendPasswordResetEmail(auth, norm(email));
}

// Signing out removes this account's data from the device (it stays in the account).
// Unless force is set, it first tries to upload what is left and reports what couldn't go.
export async function signOut({ force = false } = {}) {
  if (live && !force) {
    clearTimeout(timer);
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 5000))]);
    const pending = countPending();
    if (pending) return { pending };
  }
  stop();
  setPendingCode('');
  inviteFailed = false;
  const hadAccountData = !!sync;
  sync = null;
  saveState();
  if (hadAccountData) store.resetData();
  await A.signOut(auth);
  return { pending: 0 };
}
