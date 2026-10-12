# Developing

How the code is organised and how to run it. For using the app, see the [README](../README.md); for
Firebase and the bug-report Action, see [SETUP.md](SETUP.md).


Plain HTML, CSS and JavaScript modules. There is no build step and no dependencies. The Firebase SDK is
loaded from Google's CDN only when sync is configured.

```sh
npm start   # serve locally at http://localhost:8080
npm test    # unit tests: scheduler, answer checking, languages, session building, sync merging
```

| File | What's in it |
|---|---|
| `js/app.js` | Starts the app: registers the screens and page-wide listeners |
| `js/router.js` | Hash routing, the tab bar and the language pill |
| `js/views/` | One file per screen: Today, Look up, Words, Write (`correct.js`), Profile, Settings, the account card, word editor and suggestions |
| `js/practice/` | The session: `runtime.js` (tasks and what happens after an answer), `render.js` (the session screen), `grade.js` (checking answers) |
| `js/ui/` | Shared helpers: DOM (`dom.js`), active language and screen state (`context.js`), shared HTML (`text.js`), bottom sheets (`sheet.js`) |
| `js/answer.js` | Grading rule exercises, and what is saved and requeued after an answer (pure, tested) |
| `js/stats.js` | The mistake profile's numbers (pure, tested) |
| `js/background.js` | Gemini work done in the background: furigana, rule exercise sets, gap sentences |
| `js/gemini.js` | All Gemini prompts and their JSON response schemas |
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
| `js/i18n.js` | German and English UI text |
| `sw.js` | Service worker: the app opens from the cached version, updates download in the background |

The app is hosted on GitHub Pages from the `main` branch. Anything merged to `main` goes live within a
minute or two.
