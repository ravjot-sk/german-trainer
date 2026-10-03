# German Trainer

A web app for active German practice, built from the approved product spec
("German Trainer: Product Spec"). It installs to the iPhone home screen and also works on a computer.

## What v1 does

- **Nachschlagen (Look up):** type a German or English word, optionally with the sentence you found it in.
  Gemini returns meaning, article, plural or verb forms, a register note and an example. Every lookup is
  saved to the word list automatically; edit or delete it from the list.
- **Korrigieren (Correct):** paste any German text. Gemini returns the corrected text and one record per
  mistake, labelled with a category from the fixed list in `js/categories.js`. Mistakes are logged; word-choice
  mistakes add the right word to the word list.
- **Heute (Today):** one mixed daily session. Words move from typed recall (with article and plural) to gap
  fill (in the sentence where you found them) to writing your own sentence. Grammar comes from your mistakes:
  fix your own past sentences, plus Gemini-generated drills (gap fill, transform, write under a constraint)
  for your weakest categories. An SM-2 scheduler decides what is due; new items join the next day, with a
  daily cap.
- **Profil (Profile):** mistake counts per category for the last 14 days, trend, and drill accuracy.
- **Einstellungen (Settings):** German/English UI, Gemini key and model, new words per day, JSON backup
  export/import.

Recall, gap fill and "fix your sentence" work offline; anything that needs Gemini is skipped while offline.

## Data and the API key

Data is stored in the browser's localStorage on each device (collections `words`, `mistakes`, `reviewItems`,
`reviews`, matching the spec's data model). The Gemini key is entered in Settings, stays on the device and is
sent only to Google's API. Firebase sync between phone and computer is the next step; until then use
Settings → Export / Import to move data.

## Run locally

No build step. Serve the folder over HTTP:

    npm start        # http://localhost:8080
    npm test         # unit tests for scheduler, answer checking and session building

## Deploy

Any static host works. For GitHub Pages: push this folder to a repo, then Settings → Pages → deploy from the
main branch root. Open the URL in Safari on the iPhone, tap Share → "Add to Home Screen".

## License

MIT, see [LICENSE](LICENSE).
