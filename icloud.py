"""Minimal client for iCloud shared albums.

Apple publishes no official API for these. The endpoints below are the ones the
public shared-album web page itself uses: undocumented, and Apple owes nobody
stability on them. Everything here is stdlib — nothing to install.

Shared by the on-demand proxy (server/app.py) and the offline backup export
(tools/sync_photos.py).
"""
import json
import urllib.request

MAX_WIDTH = 2048   # ponytail: pick an existing derivative rather than pulling in
                   # Pillow to resize. Raise it if photos look soft.
MIN_THUMB = 240    # grid tiles are ~165 CSS px, so 240+ stays sharp on retina


def post(host, token, path, body):
    url = "https://%s/%s/sharedstreams/%s" % (host, token, path)
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "text/plain"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.status, json.loads(r.read().decode()), r.headers


def resolve_host(token):
    """iCloud shards albums across partitions; the first character picks one, and
    the server redirects us with a 330 if we guessed the wrong host."""
    n = ord(token[0]) - ord("A") if token[0].isupper() else int(token[0], 36)
    host = "p%02d-sharedstreams.icloud.com" % (n % 40 + 1)
    try:
        status, data, headers = post(host, token, "webstream", {"streamCtag": None})
    except urllib.error.HTTPError as e:
        if e.code != 330:
            raise
        return e.headers.get("X-Apple-MMe-Host"), None
    if status == 330:
        return headers.get("X-Apple-MMe-Host"), None
    return host, data


def _sized(derivatives):
    return [d for d in derivatives.values()
            if d.get("checksum") and int(d.get("width") or 0) > 0]


def pick_full(derivatives):
    """Largest derivative at or under MAX_WIDTH; if every version is oversized,
    take the smallest rather than returning nothing."""
    opts = _sized(derivatives)
    fit = [d for d in opts if int(d["width"]) <= MAX_WIDTH]
    return max(fit, key=lambda d: int(d["width"])) if fit else \
        min(opts, key=lambda d: int(d["width"]))


def pick_thumb(derivatives):
    """Smallest derivative still big enough for a retina grid tile."""
    opts = _sized(derivatives)
    fit = [d for d in opts if int(d["width"]) >= MIN_THUMB]
    return min(fit, key=lambda d: int(d["width"])) if fit else \
        max(opts, key=lambda d: int(d["width"]))


def list_photos(token):
    """Newest-first list of the album's photos. Videos are skipped — they carry
    derivatives too, but they are clips, not stills for the wall.

    Returns (host, [{guid, full, thumb, width, height}, ...])
    """
    host, data = resolve_host(token)
    if data is None:
        _, data, _ = post(host, token, "webstream", {"streamCtag": None})

    out = []
    for p in data.get("photos", []):
        if p.get("mediaAssetType") == "video":
            continue
        try:
            full, thumb = pick_full(p["derivatives"]), pick_thumb(p["derivatives"])
        except ValueError:
            continue                      # no usable derivative
        out.append({"guid": p["photoGuid"], "full": full, "thumb": thumb,
                    "width": int(full["width"]), "height": int(full["height"]),
                    "date": p.get("dateCreated") or ""})
    out.sort(key=lambda p: p["date"], reverse=True)
    return host, out


def sign(host, token, guids):
    """Signed URLs keyed by derivative checksum. They expire in about an hour, so
    callers must not cache them beyond that."""
    urls = {}
    for i in range(0, len(guids), 100):            # chunked: one huge POST can fail
        _, assets, _ = post(host, token, "webasseturls",
                            {"photoGuids": guids[i:i + 100]})
        for checksum, it in assets["items"].items():
            urls[checksum] = "https://%s%s" % (it["url_location"], it["url_path"])
    return urls


def _self_check():
    d = {"a": {"width": 257, "height": 342, "checksum": "a"},
         "b": {"width": 1537, "height": 2049, "checksum": "b"},
         "c": {"width": 4000, "height": 3000, "checksum": "c"}}
    assert pick_full(d)["checksum"] == "b", "largest under the cap"
    assert pick_thumb(d)["checksum"] == "a", "smallest still big enough"
    assert pick_full({"c": d["c"]})["checksum"] == "c", "all oversized -> smallest"
    assert pick_thumb({"c": d["c"]})["checksum"] == "c", "none small enough -> largest"
    print("icloud self-check ok")


if __name__ == "__main__":
    _self_check()
