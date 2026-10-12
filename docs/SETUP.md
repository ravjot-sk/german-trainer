# Owner setup

One-time steps for whoever runs their own copy of the app. Users of the app don't need any of this; see the
[README](../README.md).

## Firebase (accounts and sync)

Sync uses a free Firebase project. Until it's set up, the account card says accounts aren't set up yet.

1. Go to [console.firebase.google.com](https://console.firebase.google.com), sign in with your Google
   account and create a project (Google Analytics is not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password**: turn on the first switch
   (Email/Password, not the email link) and save.
3. **Build → Firestore Database → Create database**: pick a location near you (for example
   `europe-west3`, Frankfurt) and start in **production mode**.
4. In Firestore, open the **Rules** tab, replace everything with the contents of
   [`firestore.rules`](../firestore.rules), and tap **Publish**. Do this again whenever `firestore.rules`
   changes (it did when languages were added).
5. **Project settings (⚙️) → General → Your apps → Web (`</>`)**: register an app called German Trainer
   (no Firebase Hosting). Copy the `firebaseConfig` values it shows into
   [`js/firebase-config.js`](../js/firebase-config.js) in place of `null`, and push that to `main`. These
   values aren't secret; the rules decide who can read what.

**Inviting yourself:** in **Firestore Database → Data**, start a collection called `allowlist` (first
time only), then add a document whose **Document ID** is your email address in lowercase, for example
`ravi@example.com`. Give it any field, for example `name` = your name. You can invite anyone else the
same way, but invite codes (below) are easier.

**Making yourself an admin** (one time): create your account in the app first. Then in
**Authentication → Users**, copy the **User UID** of your account. In **Firestore Database → Data**,
start a collection called `admins` and add a document whose **Document ID** is that UID, with any
field, for example `name` = your name. Nothing about you goes into the code. Reopen Settings and an
**Einladungscodes** section appears below your account.

**Invite codes:** in **Einladungscodes**, choose how many people may use a code (1 for one person, more
for a group), tap **Neuen Code erstellen** and send the code (it's copied for you). Anyone who enters it
when creating their account, or later on the "not invited" screen, is added to `allowlist` with the
code they used. The list shows how often each code has been used. **Löschen** stops a code; people who
already joined keep access.

**Removing someone:** delete their document in `allowlist`.

Everyone's data is private: each person can only read and write their own, and Firebase's free plan is
plenty for a small group.

## Bug reports to GitHub issues

Reports sent from the app wait in Firestore (`bugReports`, which users can add to but not read). Every
hour, the **Bug reports to issues** GitHub Action opens one issue per report, labelled `user-report`, and
deletes the report from Firestore. Until the secret below is added, the Action runs but does nothing.

1. Publish the current [`firestore.rules`](../firestore.rules) (step 4 above).
2. **Project settings (⚙️) → Service accounts → Generate new private key**. This downloads a JSON file.
3. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, named
   `FIREBASE_SERVICE_ACCOUNT`, with the whole content of that file as its value. Then delete the file.
4. To try it, open **Actions → Bug reports to issues → Run workflow**. Tick **dry run** to only print the
   issues in the log without creating or deleting anything.

The key gives full access to the Firebase project, so keep it only in that secret. An issue shows the
reporter as the first 8 characters of their user id, which you can look up under **Authentication**.
GitHub pauses scheduled Actions in a repository with no activity for 60 days; **Actions** then shows a
button to turn it back on.
