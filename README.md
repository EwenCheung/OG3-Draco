# OG3 Draco

A small group website for OG3 Draco — 主页、成员、排行榜、出席、照片墙.

No login, no backend, no framework, no npm. Five static pages; the four data pages read live data
from a Google Sheet, plus a nightly GitHub Action that refreshes the photo wall from
our iCloud shared album.

Live at **https://ewencheung.github.io/OG3-Draco/**

## Running it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

A `file://` open will not work — `fetch()` of the sheet and the photo manifest needs a
real origin.

To populate the photo tab locally:

```bash
python3 tools/sync_photos.py --random 20
```

## How it works

| | |
|---|---|
| **Members, leaderboards, attendance** | Read straight from a published Google Sheet in the browser, via the gviz JSON endpoint. Update the sheet, reload the page — no deploy. |
| **Photos** | A nightly Action picks 20 at random from the iCloud shared album and publishes them with the Pages deploy. They are gitignored and never committed. |
| **Hosting** | GitHub Pages, deployed by Actions. Nothing to run, nothing to pay for. |

The Members page renders everyone's `Role`. The spreadsheet formulas decide who appears
on each leaderboard and calculate every rank, score and attendance rate.

## Layout

Phone first. The home page is the entry point, with feature cards linking to every section.
Grids are fluid (`auto-fit` + `minmax()`, `column-width`, `clamp()`), so
the layout follows the actual viewport at every width instead of snapping between a
few presets. The single real breakpoint is 768px, where the nav moves from a bottom
tab bar to a top bar.

## Setup

Two things live outside the repo:

1. **`ALBUM_TOKEN`** — repository secret, the part after `#` in the iCloud shared album
   link. Settings → Secrets and variables → Actions.
2. **Pages source** — must be set to **GitHub Actions**, not "Deploy from a branch",
   because the photos are built during the run.

The Google Sheet must be shared as **Anyone with the link → Viewer**. Give edit access
to specific people by email; the sheet ID is visible in the page source, so anything in
that spreadsheet is effectively public.

## Layout of the repo

```
index.html  members.html  leaderboard.html  attendance.html  photos.html
style.css                one stylesheet
app.js                   one script, shared by all five pages
icloud.py                iCloud shared-album client (stdlib only)
tools/sync_photos.py     picks and downloads the daily 20
tools/make_icons.sh      regenerates app icons from one square image
.github/workflows/       nightly photo refresh + Pages deploy
PLAN.md                  the decisions behind all of the above
```

Read `PLAN.md` before changing things — several choices there are deliberate and
easy to undo by accident.
