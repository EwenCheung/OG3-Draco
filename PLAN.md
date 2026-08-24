# OG3 Draco — group website

## Context

Empty repo. A small, no-login website for the OG3 Draco group, built phone-first and
installable to the home screen. Four tabs: members, leaderboards, attendance, photos.

The shape of it:

- **All data lives in one Google Sheet.** The site reads it directly from the browser.
  Anyone with edit access updates members, scores or attendance from their phone, and
  the site reflects it on next load. No deploy, no code, no server.
- **No backend, no database, no login.** Nothing to pay for, nothing to keep alive.
- **Photos sync into the repo** from the iCloud shared album via a script. Apple's
  signed photo URLs expire in about an hour, so linking live isn't possible — we
  download once.
- **Plain HTML/CSS/JS**, no framework, no bundler, no npm. GitHub Pages, deploy on push.
- **Everyone is just a member.** No OGL/OGM distinction anywhere in the UI.

## Setup — what you provide

**1. The Google Sheet.** One spreadsheet, four tabs named exactly:

| tab | columns |
|---|---|
| `members` | `name`, `hall`, `mbti`, `birthday`, `instagram` |
| `upz` | `name`, `score`, `note` |
| `pokemon` | `name`, `score`, `note` |
| `attendance` | A1 blank, names down column A, event names across row 1, `1` for present |

Share → General access → **Anyone with the link** → **Viewer**. Viewer, not Editor —
Editor would let anyone holding the URL rewrite your data. Give edit access to specific
people by email instead.

Format the `birthday` column as **plain text** (`12 Mar 2003` or `2003-03-12`). Google's
API returns date-formatted cells in a different shape with a zero-indexed month, which
silently shifts every birthday back one month. The code handles both forms, but plain
text avoids the class of bug entirely.

**2. The iCloud album.** On your iPhone: Photos → the shared album → the **People** tab
at the bottom → turn on **Public Website**. That produces a link like
`https://www.icloud.com/sharedalbum/#B0Abc123...`. The part after `#` is the token the
sync script needs.

**3. Member photos.** Portraits into `assets/members/`, matched to sheet names
automatically — `Ewen Cheung` → `ewen-cheung.jpg`. No filename column to maintain; a
missing file falls back to an initials circle.

**4. An app icon — optional.** The Draco mascot ships as the icon, so nothing is blocked.
To use your own instead: drop a square image at `assets/brand/icon-source.png` and run
`tools/make_icons.sh`, which regenerates every size using macOS's built-in `sips`. No
image library to install, and nothing else to edit.

## How data loading works

Each page fetches the tab it needs from the gviz endpoint:

```
https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:json&sheet=members
```

The response is JSON wrapped in a `google.visualization.Query.setResponse(...)` prefix —
slice it off, `JSON.parse`, read `table.rows`. Using the JSON output rather than
`out:csv` avoids hand-rolling a CSV parser and its quoting bugs.

Every successful fetch is stashed in `localStorage`. If a later fetch fails, the page
renders the last good copy with a small *"showing saved copy"* note instead of going
blank. All storage access wrapped in try/catch — it throws outright in some
private-browsing contexts.

The Sheet ID sits in the page source, which is unavoidable for client-side fetching and
harmless given the sheet is link-viewable anyway. Just don't keep anything private in
that spreadsheet.

## 1. Members — `index.html`

One flat list of everyone, two view modes toggled at the top:

- **Grid** — photo cards with name, MBTI, birthday, hall, Instagram.
- **List** — no photos, one compact row each, same fields. Faster to scan and to find
  a specific name.

Chosen view remembered in `localStorage`. Birthday renders as `12 Mar`. Instagram
renders as `@handle` linking to `instagram.com/handle` in a new tab. A missing photo
falls back to initials; a missing Instagram just omits the line. A gap in the data
should never break a card.

Portraits are `loading="lazy"` in fixed aspect-ratio boxes, so the grid doesn't jump
around as they load.

## 2. Leaderboards — `leaderboard.html`

Both boards on one page, each sorted by score descending with the top three marked.
Stacked vertically on phone, side by side from iPad up.

## 3. Attendance — `attendance.html`

Tick or cross only. A Sheets **checkbox** (Insert → Checkbox) is the easiest thing to
tap on a phone mid-event and gives `TRUE`/`FALSE`; typed `1`, `y`, `✓` or `是` also
count as present. Anything else, including blank, counts as absent.

- **Easy view (default):** one row per person — photo, name, `8/10`, percentage, sorted
  by attendance. Readable on a phone with no horizontal scrolling.
- **Tap a person:** expands to show which specific events they made or missed.
- **Full grid behind a toggle:** the whole members × events matrix, in its own
  horizontally-scrolling container so the page body never scrolls sideways.

Names are matched against the `members` tab for photos. Any attendance name with no
match still appears, without a photo — silently dropping someone over a typo is exactly
what makes an attendance page untrustworthy.

## 4. 今日精选 Top Picks — `photos.html`

Not the whole album — **20 photos, picked at random, refreshed every night.** The
album holds 675 photos and 140 videos; all of it full-size would be ~646MB. Twenty is
a page you actually scroll to the end of, and it's different tomorrow.

`.github/workflows/daily-photos.yml` runs at 16:00 UTC (= midnight Singapore/Malaysia),
and on every push, and on demand via *Run workflow*. It:

1. runs `tools/sync_photos.py --random 20`, which lists the album, skips videos, takes
   a random sample, and downloads a thumbnail plus a full-size copy of each,
2. publishes the whole site *including those photos* as a **Pages deploy artifact**.

**The photos are never committed.** `photos/` is in `.gitignore` and exists only inside
the build. Committing 20 photos nightly would add ~20MB to git history every day — some
7GB a year, permanently, because git never forgets a blob. Building them into the
artifact keeps the repo at a few hundred KB forever.

The album token lives in the repo secret `ALBUM_TOKEN`.

**Page:** grid tiles use the thumbnails (~90KB), so the page is light on mobile data;
the lightbox loads full size only for the photo actually opened, using the native
`<dialog>` element — Esc and backdrop-dismiss come free, no lightbox library. A play
button auto-advances for the "flashing memory" feel.

The iCloud endpoints are undocumented. If Apple changes them the nightly run fails
loudly in the Actions tab, and the site keeps serving the last good deploy.

## Home-screen app

`manifest.json` (standalone display, theme colour, 192/512 icons) plus an
`apple-touch-icon` link. Added to a home screen, it launches fullscreen with the real
icon and the name "OG3 Draco" — no browser chrome.

Two buttons in the UI:

- **Add to Home Screen** — on Android, captures `beforeinstallprompt` and fires the real
  install dialog. On iPhone, Apple provides no such API, so it opens a short panel
  showing the Share → Add to Home Screen steps. Hidden entirely once running in
  standalone mode, or where neither path applies.
- **Share** — `navigator.share()`, the native share sheet, for firing the link into the
  group chat. Falls back to copy-to-clipboard on desktop.

**No service worker, so no offline support.** Add one when someone actually complains
about opening it with no signal; it's the piece that introduces a caching layer capable
of serving people a stale version after a deploy.

## Design

### Palette — jade, not "success green"

Deep jade primary against a warm cream background, with a soft gold accent reserved for
top-three leaderboard marks. Jade suits a dragon mascot and a Chinese-English group
without being on-the-nose; a bright generic green is what makes a site look templated.
Cream instead of pure white keeps it from feeling clinical.

| token | light | dark |
|---|---|---|
| background | `#FAF8F3` | `#0C1310` |
| surface | `#FFFFFF` | `#131C18` |
| text | `#16221D` | `#E9EFEA` |
| muted text | `#5F6E67` | `#93A39B` |
| primary (jade) | `#0E6B4F` | `#3FBF8E` |
| accent (gold) | `#C8992F` | `#E0B455` |
| border | `#E2DDD1` | `#24322B` |

All defined as CSS custom properties on `:root`, swapped under
`prefers-color-scheme: dark`.

### Type

`Fredoka` from Google Fonts for the wordmark, headings and nav — rounded and warm, it
matches the mascot without tipping into childish. System stack for body text, because
it's faster and reads better at small sizes. Chinese falls through to the named CJK
faces in both cases, which is normal and looks right.

### Mascot — Draco

An original cute dragon, hand-drawn in SVG and animated with CSS: a gentle float, an
occasional blink, a slow tail sway. About 5KB, sharp at any size, no libraries, no
battery drain. Drawn from scratch rather than borrowing 奶龙 or Kung Fu Panda artwork —
those are someone else's characters, and an original means it can be the app icon and
favicon freely.

Appears as: the app icon and favicon, a small animated dragon beside the wordmark in the
header, and the loading and empty states. Deliberately **not** a big hero image — that
costs phone vertical space, which is the scarcest thing in this layout.

### Layout

Phone is the design target; iPad and laptop are widened versions of it.

- **Fluid, not breakpoint-driven.** Grids use `auto-fit` + `minmax()` and the photo
  wall uses `column-width`, so the column count follows the actual viewport at every
  width instead of snapping at two or three hand-picked sizes. Type and gutters use
  `clamp()`. A 360px phone, a 412px phone, a split-screen iPad and a 1440px laptop each
  get a layout fitted to them, not the nearest preset.
- The one real breakpoint left is 768px, where the nav switches from a bottom bar to a
  top bar. That's a genuine mode change, not something that can be interpolated.
- Content gets a max width so it doesn't stretch absurdly on a wide screen.
- **Nav is a bottom tab bar on phones** — four tabs, thumb-reachable — moving to a top
  bar from iPad up. This is the main thing that makes it feel like an app.
- Tap targets at least 44px. `env(safe-area-inset-*)` padding so the bottom bar clears
  the iPhone home indicator in standalone mode.
- Font stack includes Simplified Chinese faces — see 语言 below.
- `<meta name="robots" content="noindex">` on every page, so the site stays out of
  search results. Worth being clear-eyed: this is a request to search engines, not a
  wall. Anyone with the link can open everything on the site.

## Files

```
PLAN.md               this document
index.html            members
leaderboard.html
attendance.html
photos.html
style.css             one stylesheet, shared
app.js                one script, shared; each page calls what it needs
manifest.json
assets/brand/         dragon.svg, favicon.svg, icon-192.png, icon-512.png,
                      apple-touch-icon.png  ← swap point for your own icon
assets/members/*.jpg  portraits, matched by name
icloud.py             shared iCloud shared-album client (stdlib only)
tools/sync_photos.py  picks + downloads the daily 20
.github/workflows/    nightly photo refresh + Pages deploy
photos/               built at deploy time, gitignored, never committed
tools/make_icons.sh   regenerate every icon size from one square image
```

Sheet ID and album token are inline constants at the top of `app.js` and
`sync_photos.py`. No config file for two values.

## Verification

- `python3 -m http.server` from the repo root, then `localhost:8000`.
  **A `file://` open will not work** — `fetch()` of local JSON is blocked without a real
  origin.
- Members: everyone renders in both views; toggle persists across reload. Clear a photo
  and an Instagram value, confirm the card degrades rather than breaks. Check one
  birthday against the sheet — specifically the month.
- Leaderboards: both populate. Edit a score in the sheet, reload, confirm it changes.
- Attendance: hand-check two people's counts against the sheet. Add a sheet name that
  isn't in `members` and confirm it still appears. Confirm the full grid scrolls inside
  itself without the page scrolling sideways.
- Saved-copy fallback: load once, point the Sheet ID at garbage, reload — confirm the
  last good data renders with the notice rather than a blank page.
- Photos: `--dry-run` lists photos; a real run downloads them; the grid renders; the
  lightbox opens and Esc closes it; re-running fetches nothing new.
### Responsive check — just look at it

Playwright is used to *see* the pages, not to test them. No test suite, no assertions,
no CI. Serve locally, then for each of the four pages: resize, screenshot, look.

| viewport | size |
|---|---|
| phone | 390 × 844 (iPhone 14/15) |
| tablet | 820 × 1180 (iPad) |
| laptop | 1440 × 900 |

Looking for the obvious breakages: page scrolling sideways, the bottom nav covering
content, cards stretched or squashed, Chinese text overflowing. Twelve screenshots, one
pass, fix what looks wrong.

### On a real device

- Open the live URL on your iPhone, use the Add to Home Screen button, launch from the
  icon. Confirm the icon and name look right, no Safari chrome, the bottom nav clears
  the home indicator, all four tabs work. Then Android install if you have a device.
- Chinese renders with correct glyph forms and no tofu boxes in the bottom nav. Emulated
  browsers substitute fonts differently from real phones, so Playwright can't settle
  this one.
### Deploy

- Push to `main`, enable Pages (Settings → Pages → deploy from branch `main`,
  root), load the live URL on a phone.

## Deliberately skipped

- Backend, database, login — nothing here needs a server.
- Framework, build step, npm — four static pages.
- Service worker / offline support. Add when someone complains about no signal.
- Submission forms for scores and attendance. Add when people want to enter their own
  instead of telling you; that's where a real backend starts earning its keep.
- Push notifications, birthday reminders, member search. Add when the list is long
  enough to need it.
