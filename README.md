# Language Trainer 🇩🇪 🇯🇵

**Turn the words you look up and the mistakes you make into daily practice, in German, Japanese or any other language.**

Language Trainer is for learners who understand a language better than they can *produce* it. It is a
dictionary, a writing corrector and a daily trainer in one. Every word you look up and every mistake you make
comes back as an exercise until you can produce it correctly yourself. German and Japanese are built in, and
Gemini sets up any other language you add.

👉 **Open the app: [ravjot-sk.github.io/german-trainer](https://ravjot-sk.github.io/german-trainer/)**

<table>
  <tr>
    <td><img src="docs/screenshots/lookup.png" width="200" alt="Looking up a word"></td>
    <td><img src="docs/screenshots/correct.png" width="200" alt="A corrected text with labelled mistakes"></td>
    <td><img src="docs/screenshots/session-feedback.png" width="200" alt="Feedback on an exercise in the daily session"></td>
    <td><img src="docs/screenshots/today.png" width="200" alt="Today with your weak spots"></td>
  </tr>
  <tr>
    <td align="center">Look up</td>
    <td align="center">Correct</td>
    <td align="center">Practise</td>
    <td align="center">Track</td>
  </tr>
</table>

---

## Get started in 3 steps

### 1. Install it on your iPhone

1. Open the [app link](https://ravjot-sk.github.io/german-trainer/) in **Safari**.
2. Tap the **Share** button, then **Zum Home-Bildschirm** (Add to Home Screen).
3. Open the app from your home screen. It now runs full-screen, like a normal app.

On a computer, just open the link in any browser.

### 2. Add a free Gemini API key

The app uses Google's Gemini AI to look up words and correct your German. You need your own key, and the
free tier is enough for personal use.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** and copy it.
3. In the app, tap the ⚙️ gear (top right) and paste the key under **Gemini-API-Schlüssel**.
4. Tap **Schlüssel testen**. A green message means you're ready.

Your key is stored only on your device and is sent only to Google.

### 3. Choose your language and level

The first time you open the app, pick the language you're learning and your level (A1–C2, or JLPT N5–N1
for Japanese). Nothing is preset: every exercise, example and explanation is pitched at the level you choose,
and you can change it any time in Settings.

- **German and Japanese** are built in, each with a fixed list of grammar categories based on research into
  learners' mistakes: German on the MERLIN learner corpus, Japanese on the NAIST Goyo Corpus.
- **Any other language:** choose **+ Andere Sprache …** and type its name, for example *Spanish*. Gemini sets
  it up once (articles, readings, and its grammar categories, worked out from a fixed checklist of grammar
  areas). Because that list is generated, the app notes that it may be incomplete.
- You can learn several languages. Words, mistakes and progress are kept separate for each one; switch in
  Settings or with the language pill (for example **DE · B2**) at the top. Your levels sync with your account; which language is active is chosen on each device.

**Japanese:** type with the iPhone Japanese keyboard. Words are saved with their kana reading, and in recall
the kanji form is correct while typing only the reading counts as *almost*. Lookups also accept romaji.
Words, example sentences, saved sentences and drills show furigana above the kanji. In **Settings › Furigana**
choose *Tap* (readings appear when you tap the text, so you try reading first; the default), *Always* or *Off*.
Sentences saved before furigana existed get theirs from Gemini the first time they come up.

### 4. Use it every day

- **During the day:** look up words when you meet them, and paste in text you've written.
- **Once a day:** open **Heute** and do your session. It takes about 10 minutes.

---

## What each screen does

### 🔍 Suchen (Look up)

Type a word in the language you're learning, or an English word to find it. Gemini gives you the meaning,
article, plural or key forms (the reading for Japanese), a note on register, and an example sentence.

- **Every lookup is saved to your word list automatically.** There's no extra step.
- Tap **+ Kontext** to add the sentence where you found the word. The app picks the right meaning for
  that sentence, and later turns the sentence into a gap-fill exercise.

**Whole sentences.** Switch to **Satz** to translate a sentence (typed in English or in the language you're
learning) and pick a tone:

| Tone | When to use it |
|---|---|
| Alltag (everyday) | How people really talk day to day. This is the default. |
| Förmlich (formal) | Polite and professional: officials, work, people you don't know (Sie, keigo) |
| Informell (informal) | Casual, with friends and family (du, plain form) |

You get the translation, a one-line note on what makes it sound that way, and the useful words in it. Tap
a word to save it too. The sentence is saved automatically and joins your daily practice.

### ✏️ Schreiben (Correct)

Paste or write anything in the language you're learning: an email, a chat message, a practice paragraph.
You get back:

- the corrected text, with every change highlighted,
- each mistake with a short explanation, a grammar category such as *Adjektivendungen* in German or
  *Particles* in Japanese, and the specific **rule** it breaks, such as *Perfekt mit sein bei Zustandswechsel*.

Every mistake is saved to your profile, and its rule is scheduled for practice. If you picked the wrong word, the right
word goes into your word list too. Tap **Kopieren** to copy the corrected text.

If your text is correct but could sound more natural, you also see **Natürlicher klingt es so** with a better
phrasing and why. That's a suggestion, not a mistake. Tap **Zum Üben speichern** to add it to your sentences.

After a correction the result comes first and your text folds into one line; tap it to edit and correct again,
or tap **Neuer Text** to start over.

### ✅ Heute (Today)

Shows what's due today and your three weakest grammar areas (tap **Ganzes Fehlerprofil** for the full
profile, see below). Your daily session mixes vocabulary and grammar. The app decides what's due using spaced repetition: things
you get right come back after longer and longer gaps, and things you get wrong come back tomorrow.

**Vocabulary.** Every exercise asks you to *produce* the language, not just recognise it. Each word moves through
three stages:

| Stage | What you do |
|---|---|
| Recall | See the meaning and type the word: for German nouns with article and plural, for Japanese in kanji |
| Gap fill | Fill the word into a sentence: first the one where you found it, then new ones |
| Write | Write your own sentence with the word, and Gemini checks it |

**Gap sentences change.** Each word keeps a small set of gap sentences. Get one right and you won't see it
again for that word; get it wrong and the same sentence comes back next time. They get harder as you learn the
word (another form or tense, then longer sentences). They come from the lookup's examples and from your own
sentences in the Write exercise once corrected. When a word coming up soon runs low, Gemini writes new ones for up to ten words
in one go, in the background when a session starts.

**Sentences.** Saved sentences rotate through three exercises:

| Exercise | What you do |
|---|---|
| Say it | See the English and the tone, and write the sentence. Gemini checks it, so any correct phrasing counts. Using a different tone is never a mistake: you only get a tip on how it's usually said. |
| Put it in order | Tap the shuffled pieces back into the right order (works offline) |
| Fill the gap | Fill in the sentence's key expression |

After "write a sentence" and "say it", you may also see a more natural phrasing that you can save.

**Buttons on every exercise.**

- **Weiß ich nicht** (I don't know) shows the answer. It counts as a wrong answer, so the item comes back, but
  nothing goes into your mistake profile. **Überspringen** (Skip) moves on without saving anything.
- **Auf Englisch** (In English) appears once you've answered. It shows the English of the sentences in the
  exercise. Translations Gemini adds for gap sentences and examples are saved with the word.
- **Nochmal prüfen** (Check again) appears with the result when Gemini is set up. If a verdict looks wrong, Gemini
  checks the same answer once more, and its new verdict replaces the first. Mistakes are only saved when you tap
  **Weiter** (Next), so a mistake the second check takes back never reaches your profile. **Korrigieren** has the
  same button: there the second check replaces the first one's mistakes in your profile.

**Grammar.** This comes from your own mistakes. You practise the **rule** behind a mistake, in new sentences
each time, never by re-fixing the old sentence. Each rule climbs a ladder of five steps:

| Step | Exercise | What you do |
|---|---|---|
| 1 | Erkennen | Two versions of a sentence: pick the right one |
| 2 | Wählen | Fill the gap exactly where the rule decides (*Was ___ passiert?*) |
| 3 | Umformen | Change three short sentences, each with a different verb or noun |
| 4 | Finden | A short text has mistakes against the rule: correct them |
| 5 | Schreiben | Write a new sentence that needs the rule |

New rules start at step 2. A right answer moves the rule up a step, a wrong one moves it down. Passing step 5
on two different days marks it as mastered (*Sitzt*). Making the same mistake again in your writing moves the
rule back down and brings it up again. A rule you just broke while writing comes up again a few exercises later.
Mistakes in categories without rules yet get general drills for that category.

Tips:
- If you were right but typed it slightly differently, tap **Ich lag richtig** to count it as correct.
- New words and rules join your session **the same day** you add them. You get at most 8 new words a day by default,
  and you can change this in Settings. New sentences have their own limit of 3 a day.
- Words and old sentences you get wrong come back once more at the end of the session.

**Freies Üben (Free practice).** Below the daily session on **Heute**, tap **Üben** to practise as long as you
like, even when nothing is due. It goes in rounds: each round brings up everything in your focus once, and
words and grammar you got wrong recently, have missed often or haven't seen for a while tend to come earlier.
Choose a focus first if you want: **Gemischt** (mix), **Wörter**, **Sätze**, **Grammatik** or
**Schwächen** (weak spots). The top shows how many you got right; tap ✕ to stop.

- A right answer counts as a success: the word's next exercises get harder (recall, gap, writing, and harder
  gap sentences), but its date for the daily session stays where it is.
- A wrong answer counts too: the word comes back a few tasks later and in tomorrow's session.
- After each round you can mix in saved words you haven't started yet (beyond the daily limit, up to that many
  per round), get suggested words, or go round again.

### 📖 Wörter (Words)

All your saved words and sentences, with a filter to show only one kind. Search them, tap one to edit any field, or delete words you don't want to practise.
Tap **+** to add a word by hand. Rarely needed fields (register, example, gap sentence) are under **Mehr Felder**.

**Wörter vorschlagen (Suggest words).** Tap ✨ (also on **Heute** while your list is short) and Gemini suggests
8 words that fit your level, leaving out words you already have. Add a topic such as *Arbeit* to steer it. All
suggestions are ticked; untick the ones you don't want and tap **Hinzufügen**. They join your list like a
lookup and come up in your sessions.

### 📊 Fehlerprofil (Profile)

Open it from **Heute** → **Ganzes Fehlerprofil**. See which grammar areas trip you up most. For each category you see:

- how often it came up in the **last 14 days**,
- whether it is **improving** (wird besser) or coming up **more often** (häufiger),
- your score in drills for that category,
- the **rules** under it, each marked *Neu*, *Wackelig* (being practised) or *Sitzt* (mastered). Tap a rule
  to see what it says and the mistakes you made against it.

Mistakes saved before rules existed are sorted into the current categories and given their rule in the
background the first time you open the profile (needs Gemini).

---

## Settings

Tap the ⚙️ gear (top right).

| Setting | What it does |
|---|---|
| Ich lerne / Mein Niveau | The language you're practising and your level in it; add another language here |
| Sprache der App | Switch the app's own buttons and explanations between German and English |
| Konto & Synchronisierung | Sign in to keep your data the same on all your devices (invite only, see below) |
| Gemini-API-Schlüssel | Your API key (see step 2 above) |
| Erweitert → Gemini-Modell | Which Gemini model to use. The default works, and **Modelle laden** shows the others |
| Neue Wörter pro Tag | How many new words join your session each day |
| Sicherung | Export your data to a file, or import it again |

---

## Good to know

**Where is my data?** On your device, in the app itself. If you sign in, it is also kept in your private
account so your other devices get it too. The text you send for lookups and corrections goes to Gemini.
Your Gemini key never leaves the device.

**Back up now and then.** Use **Einstellungen → Sicherung → Exportieren** to save a backup file. You can
**import** that file again later. If you're signed in, your account is already a backup.

**Offline?** Recall, gap fill and word order work without internet. Lookups, corrections and
exercises that need Gemini wait until you're back online.

**Something not working?**
- *"Bitte zuerst den Gemini-Schlüssel eintragen"*: add your key in Settings.
- *"Gemini-Fehler: …"*: tap **Schlüssel testen** in Settings. If the model isn't found, open **Erweitert**,
  tap **Modelle laden** and pick a "flash" model.
- *The app looks out of date*: close it and open it again. Updates load in the background.

---

## Accounts and sync

Accounts are optional and invite only. Without one, the app works exactly as before, with data on the
device only.

1. In **Einstellungen → Konto & Synchronisierung**, enter your email and a password and tap
   **Konto erstellen**.
2. Open the confirmation link in the email you get, then tap **Ich habe bestätigt** in the app.
3. If your email hasn't been invited yet, ask the app's owner to invite it, then tap **Erneut prüfen**.
4. On your other devices, tap **Anmelden** with the same email and password.

The first time you sign in, everything already on that device is added to your account. Changes you make
offline are sent once you're back online. **Abmelden** removes your data from that device; it stays in your
account and comes back when you sign in again.

### Setting up Firebase (app owner, one time)

Sync uses a free Firebase project. Until it's set up, the account card says accounts aren't set up yet.

1. Go to [console.firebase.google.com](https://console.firebase.google.com), sign in with your Google
   account and create a project (Google Analytics is not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password**: turn on the first switch
   (Email/Password, not the email link) and save.
3. **Build → Firestore Database → Create database**: pick a location near you (for example
   `europe-west3`, Frankfurt) and start in **production mode**.
4. In Firestore, open the **Rules** tab, replace everything with the contents of
   [`firestore.rules`](firestore.rules), and tap **Publish**. Do this again whenever `firestore.rules`
   changes (it did when languages were added).
5. **Project settings (⚙️) → General → Your apps → Web (`</>`)**: register an app called German Trainer
   (no Firebase Hosting). Copy the `firebaseConfig` values it shows into
   [`js/firebase-config.js`](js/firebase-config.js) in place of `null`, and push that to `main`. These
   values aren't secret; the rules decide who can read what.

**Inviting someone:** in **Firestore Database → Data**, start a collection called `allowlist` (first
time only), then add a document whose **Document ID** is their email address in lowercase, for example
`ravi@example.com`. Give it any field, for example `name` = their name. Invite yourself the same way.
To remove someone's access, delete their document.

Everyone's data is private: each person can only read and write their own, and Firebase's free plan is
plenty for a small group.

---

## For developers

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
| `js/firebase-config.js` | Firebase project config (`null` turns accounts off) |
| `firestore.rules` | Security rules: invite-only allowlist, each user sees only their own data |
| `js/i18n.js` | German and English UI text |
| `sw.js` | Service worker for offline use |

The app is hosted on GitHub Pages from the `main` branch. Anything merged to `main` goes live within a
minute or two.

## License

Copyright (C) 2026 ravjot-sk

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
option) any later version. See [LICENSE](LICENSE) for the full text.
