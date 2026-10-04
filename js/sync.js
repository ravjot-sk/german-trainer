// Account sync with Firebase (Auth + Firestore). The app stays local-first: localStorage
// is what the app reads and writes, and this module mirrors it to
// users/{uid}/{collection}/{id} in Firestore and merges other devices' changes back in
// (rules in syncmerge.js). Access is invite-only and private, enforced by firestore.rules.
// The Firebase SDK is loaded on demand, so the app still starts offline or without config.
import * as store from './store.js';
import { firebaseConfig } from './firebase-config.js';
import { COLLECTIONS, pendingChanges, applyRemote } from './syncmerge.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const STATE_KEY = 'gt.sync.v1';
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
  return { status, email: user?.email || '', error: lastError, pending: live ? countPending() : 0 };
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setStatus(s) {
  if (s === status) return;
  status = s;
  listeners.forEach((fn) => fn(getState()));
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
  if (!user) return setStatus('signedOut');
  if (!user.emailVerified) return setStatus('unverified');
  setStatus('loading');
  try {
    const snap = await F.getDoc(F.doc(db, 'allowlist', user.email.toLowerCase()));
    if (!snap.exists()) return setStatus('notInvited');
  } catch (e) {
    if (e.code === 'permission-denied') return setStatus('notInvited');
    // Offline: a device that already syncs this account carries on from its local data.
    if (sync?.uid !== user.uid) { lastError = e.message; return setStatus('error'); }
  }
  start();
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
    docs.push({ ...d, id: ch.doc.id });
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
      const ref = F.doc(db, 'users', uid, op.coll, op.id);
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

// ---------- account actions (errors are Firebase errors with a .code) ----------
const norm = (email) => email.trim().toLowerCase();

export async function signIn(email, password) {
  await init();
  await A.signInWithEmailAndPassword(auth, norm(email), password);
}

export async function signUp(email, password) {
  await init();
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
  const hadAccountData = !!sync;
  sync = null;
  saveState();
  if (hadAccountData) store.resetData();
  await A.signOut(auth);
  return { pending: 0 };
}
