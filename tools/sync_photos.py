#!/usr/bin/env python3
"""Pull photos out of the OG3 Draco iCloud shared album into photos/.

Run nightly by .github/workflows/daily-photos.yml to build 今日精选 — a random
20 from the album. The photos are published as part of the Pages deploy and are
never committed, so git history stays clean.

    tools/sync_photos.py --random 20      # random pick (what the site uses)
    tools/sync_photos.py --limit 50       # newest 50 instead
    tools/sync_photos.py --dry-run        # list without downloading
    tools/sync_photos.py --out ~/og3-pics # somewhere other than ./photos

Downloads a thumbnail and a full-size copy of each, skips anything already on
disk, and writes manifest.json alongside them.
"""
import json
import os
import random
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import icloud  # noqa: E402

TOKEN = os.environ.get("ALBUM_TOKEN", "B2K5qXGF1r03bJO")


def sync(out, dry_run=False, limit=None, pick=None):
    host, photos = icloud.list_photos(TOKEN)
    print("Album has %d photos (videos skipped)." % len(photos))
    if pick:
        photos = random.sample(photos, min(pick, len(photos)))
        print("Randomly picked %d." % len(photos))
    elif limit:
        photos = photos[:limit]
        print("Limited to newest %d." % len(photos))

    thumbs = os.path.join(out, "thumb")
    os.makedirs(thumbs, exist_ok=True)

    plan, todo = [], []
    for p in photos:
        name = p["full"]["checksum"] + ".jpg"
        plan.append({"file": name, "thumb": "thumb/" + name,
                     "width": p["width"], "height": p["height"]})
        if not os.path.exists(os.path.join(out, name)):
            todo.append((p, name))

    mb = sum(int(p["full"].get("fileSize") or 0) + int(p["thumb"].get("fileSize") or 0)
             for p, _ in todo) / 1e6
    print("%d new (%.0f MB)." % (len(todo), mb))
    if dry_run:
        for p, name in todo[:15]:
            print("  would fetch %s  %sx%s" % (name, p["width"], p["height"]))
        if len(todo) > 15:
            print("  ... and %d more" % (len(todo) - 15))
        return

    if todo:
        urls = icloud.sign(host, TOKEN, [p["guid"] for p, _ in todo])
        for i, (p, name) in enumerate(todo, 1):
            for key, path in (("full", os.path.join(out, name)),
                              ("thumb", os.path.join(thumbs, name))):
                url = urls.get(p[key]["checksum"])
                if url and not os.path.exists(path):
                    urllib.request.urlretrieve(url, path)
            if i % 10 == 0 or i == len(todo):
                print("  %d/%d" % (i, len(todo)))

    have = set(os.listdir(out))
    manifest = [e for e in plan if e["file"] in have]
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print("manifest.json: %d photos in %s" % (len(manifest), out))


if __name__ == "__main__":
    a = sys.argv
    sync(out=os.path.abspath(a[a.index("--out") + 1]) if "--out" in a
         else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "photos"),
         dry_run="--dry-run" in a,
         limit=int(a[a.index("--limit") + 1]) if "--limit" in a else None,
         pick=int(a[a.index("--random") + 1]) if "--random" in a else None)
