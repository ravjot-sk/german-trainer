// Turns bug reports sent from the app (Firestore bugReports) into GitHub issues, then deletes
// them from Firestore. Run by .github/workflows/bug-reports.yml every hour.
// Needs FIREBASE_SERVICE_ACCOUNT (the service-account JSON), and GITHUB_TOKEN and
// GITHUB_REPOSITORY (set by Actions). DRY_RUN=1 prints the issues and changes nothing.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { issueFromReport } from '../js/report.js';

const dry = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
// Until the secret is added, every run would fail and send a failure email each hour.
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('FIREBASE_SERVICE_ACCOUNT secret is not set yet; nothing to do.');
  process.exit(0);
}
if (!dry && (!repo || !token)) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are needed');

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

// A short tag instead of the email: the start of the account's uid, which can be looked up
// under Authentication in the Firebase console.
const reporter = (uid) => String(uid || '').slice(0, 8);

const gh = (path, body) => fetch(`https://api.github.com/repos/${repo}${path}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  body: JSON.stringify(body),
});

async function createIssue(issue) {
  const res = await gh('/issues', issue);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return (await res.json()).html_url;
}

const snap = await db.collection('bugReports').orderBy('createdAt').limit(50).get();
console.log(`${snap.size} report(s)`);
// The label, if the repo doesn't have it yet (422 when it already exists).
if (!dry && snap.size) await gh('/labels', { name: 'user-report', color: 'd93f0b', description: 'Sent from the app' });
let failed = 0;
for (const doc of snap.docs) {
  const r = doc.data();
  const issue = issueFromReport(r, { reporter: reporter(r.uid), createdAt: r.createdAt?.toDate().toISOString() || '' });
  if (dry) {
    console.log(`--- ${doc.id}\n${issue.title}\n\n${issue.body}\n`);
    continue;
  }
  try {
    const url = await createIssue(issue);
    // Deleted only once its issue exists, so a failed run tries again next time.
    await doc.ref.delete();
    console.log(`${doc.id} -> ${url}`);
  } catch (e) {
    failed++;
    console.error(`${doc.id}: ${e.message}`);
  }
}
if (failed) process.exit(1);
