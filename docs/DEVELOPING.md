# Developing

How the code is organised and how to run it. For using the app, see the [README](../README.md); for
Firebase and the bug-report Action, see [SETUP.md](SETUP.md).


Plain HTML, CSS and JavaScript modules. There is no build step, and the app has no dependencies (ESLint is only a development tool). The Firebase SDK is
loaded from Google's CDN only when sync is configured.

```sh
npm start   # serve locally at http://localhost:8080
npm run lint   # ESLint: undefined and unused names (run npm install once first)
npm test    # unit tests: scheduler, answer checking, languages, session building, sync merging
```

The linter and the tests also run automatically on every pull request and every push to `main` (`.github/workflows/tests.yml`).

| File | What's in it |
|---|---|
| `js/app.js` | Starts the app: loads the store, registers the screens and page-wide listeners |
| `js/router.js` | Hash routing, the tab bar and the language pill |
| `js/views/` | One file per screen: Today, Look up, Words, Write (`correct.js`), Profile, Settings, the account card and word editor |
| `js/practice/` | The session: `runtime.js` (tasks and what happens after an answer), `render.js` (the session screen), `grade.js` (checking answers), `feedback.js` (the feedback after an answer) |
| `js/ui/` | Shared screen pieces: DOM (`dom.js`), screen state (`context.js`), shared HTML (`text.js`), bottom sheets (`sheet.js`), suggested words (`suggest.js`), the bug report sheet (`report.js`), the category list (`catlist.js`) |
| `js/appstate.js` | The active language, whether Gemini can be used, the furigana setting: shared by screens and background jobs |
| `js/answer.js` | Grading rule exercises, and what is saved and requeued after an answer (pure, tested) |
| `js/stats.js` | The mistake profile's numbers (pure, tested) |
| `js/background.js` | Gemini work done in the background: furigana, rule exercise sets, gap sentences |
| `js/gemini.js` | The Gemini features as the app calls them |
| `js/gemini/` | `client.js` sends a request; `words.js`, `sentences.js`, `grading.js`, `grammar.js`, `setup.js` build each prompt and schema and clean the reply (pure, tested); `shared.js` holds the common pieces |
| `js/gemclient.js` | Gemini requests: time limit, retries when Google is busy, foreground-first queue |
| `js/session.js` | Builds the daily mixed session |
| `js/srs.js` | Spaced-repetition scheduler (SM-2 variant) |
| `js/check.js` | Local answer checking and the correction diff |
| `js/languages.js` | Built-in languages (German, Japanese), levels, and per-language helpers |
| `js/categories.js` | The fixed grammar categories for each language, and how old categories map onto them |
| `js/rules.js` | Grammar rules: the five-step exercise ladder, exercise pool, and data migration |
| `js/ruleseeds.js` | Starting rules per category (Profile deutsch for German, JLPT lists for Japanese) |
| `js/store.js` | Local storage: `words`, `mistakes`, `reviewItems`, `reviews`, `languages` |
| `js/sync.js` | Accounts and sync: mirrors local data to Firestore `users/{uid}/…` and merges other devices' changes |
| `js/syncmerge.js` | Merge rules: per-record "latest edit wins", deletes as tombstones |
| `js/invites.js` | Invite code format |
| `js/firebase-config.js` | Firebase project config (`null` turns accounts off) |
| `firestore.rules` | Security rules: invite-only allowlist and invite codes, each user sees only their own data |
| `js/i18n.js` | UI text lookup; the strings are in `js/i18n/de.js` and `js/i18n/en.js` |
| `sw.js` | Service worker: the app opens from the cached version, updates download in the background |

Imports point one way: the files directly in `js/` (data, Gemini, background jobs) use no screen code, `js/ui/` uses only those, `js/practice/` uses both, and `js/views/` and `app.js` sit on top. `tests/layers.test.js` checks this.

The app is hosted on GitHub Pages from the `main` branch. Anything merged to `main` goes live within a
minute or two.
