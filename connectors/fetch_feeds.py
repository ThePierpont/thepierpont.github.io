#!/usr/bin/env python3
"""
Pulls updates from other sites you use and saves them to data/feeds.json,
which the site reads on load. Uses only Python's standard library.

Run it by hand:   python3 connectors/fetch_feeds.py
Or let the GitHub Action in .github/workflows/update-feeds.yml run it hourly.

Usernames come from the `connectors` block in content.js.
"""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "feeds.json"
UA = "Mozilla/5.0 (personal-site feed fetcher)"
NS = {"letterboxd": "https://letterboxd.com", "tmdb": "https://themoviedb.org"}

MAX_DIARY = 12
MAX_LISTS = 6


def setting(name):
    """Reads `connectors: { name: "value" }` out of content.js."""
    src = (ROOT / "content.js").read_text(encoding="utf-8")
    block = re.search(r"connectors\s*:\s*\{(.*?)\}", src, re.S)
    if not block:
        return ""
    m = re.search(rf"\b{name}\s*:\s*[\"']([^\"']*)[\"']", block.group(1))
    return m.group(1).strip() if m else ""


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def text_of(fragment):
    """HTML fragment → plain text with paragraph breaks."""
    fragment = re.sub(r"<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"</p>\s*", "\n\n", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(fragment)).strip()


def iso(pub):
    try:
        return parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return ""


def letterboxd(username):
    root = ET.fromstring(get(f"https://letterboxd.com/{username}/rss/"))
    diary, lists = [], []
    for item in root.iter("item"):
        guid = item.findtext("guid", "")
        desc = item.findtext("description", "")
        link = item.findtext("link", "")
        published = iso(item.findtext("pubDate"))

        if guid.startswith(("letterboxd-watch-", "letterboxd-review-")) and len(diary) < MAX_DIARY:
            poster = re.search(r'<img src="([^"]+)"', desc)
            # Drop the poster paragraph and Letterboxd's auto "Watched on …" line; what's left is the review.
            body = re.sub(r"<p><img[^>]*/?></p>", "", desc)
            review = text_of(body)
            if re.fullmatch(r"Watched on [^.]+\.", review):
                review = ""
            rating = item.findtext("letterboxd:memberRating", "", NS)
            diary.append({
                "title": item.findtext("letterboxd:filmTitle", "", NS),
                "year": item.findtext("letterboxd:filmYear", "", NS),
                "rating": float(rating) if rating else None,
                "liked": item.findtext("letterboxd:memberLike", "", NS) == "Yes",
                "rewatch": item.findtext("letterboxd:rewatch", "", NS) == "Yes",
                "watched": item.findtext("letterboxd:watchedDate", "", NS),
                "poster": poster.group(1) if poster else "",
                "review": review,
                "link": link,
                "published": published,
            })

        elif guid.startswith("letterboxd-list-") and len(lists) < MAX_LISTS:
            # Ranked lists come through as <ol>, unranked as <ul>.
            split = re.search(r"<(ul|ol)>", desc)
            intro, films_html = (desc[:split.start()], desc[split.end():]) if split else (desc, "")
            films = [
                {"title": html.unescape(t), "link": u}
                for u, t in re.findall(r'<li>\s*<a href="([^"]+)">([^<]+)</a>', films_html)
            ]
            lists.append({
                "title": item.findtext("title", ""),
                "link": link,
                "published": published,
                "description": text_of(intro),
                "ranked": bool(split and split.group(1) == "ol"),
                # The feed only includes the first 10 films and notes the rest as "...plus N more."
                "count": len(films) + int((re.search(r"plus (\d+) more", films_html) or [0, 0])[1]),
                "films": films[:5],
            })

    return {"username": username, "profile": f"https://letterboxd.com/{username}/", "diary": diary, "lists": lists}


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    failed = False

    username = setting("letterboxd")
    if username:
        try:
            out["letterboxd"] = letterboxd(username)
            lb = out["letterboxd"]
            print(f"letterboxd: {len(lb['diary'])} diary entries, {len(lb['lists'])} lists")
        except Exception as e:  # keep the last good copy if the fetch fails
            failed = True
            print(f"letterboxd: fetch failed ({e}); keeping previous data", file=sys.stderr)
            if "letterboxd" in old:
                out["letterboxd"] = old["letterboxd"]
    else:
        print("letterboxd: no username set in content.js, skipping")

    # Only rewrite the file when the content changed, so the hourly job doesn't commit for nothing.
    if {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in out.items() if k != "updated"}:
        print("no changes")
    else:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
