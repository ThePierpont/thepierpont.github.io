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

MAX_DIARY = 50  # everything in the feed; the site shows a few and folds the rest
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


def goodreads(user_id):
    """Recent books from Goodreads' official embed widget. Goodreads decides which shelf and
    how many books from the widget settings saved on your account (goodreads.com/widgets)."""
    js = get(f"https://www.goodreads.com/review/custom_widget/{user_id}").decode("utf-8", "replace")
    m = re.search(r"var widget_code = '(.*?)'\s*var widget_div", js, re.S)
    if not m:
        raise ValueError("unexpected widget format")
    page = m.group(1)
    for a, b in (('\\"', '"'), ("\\n", "\n"), ("\\/", "/"), ("\\'", "'")):
        page = page.replace(a, b)

    def field(block, cls):
        f = re.search(rf'class="{cls}">\s*(.*?)\s*</div>', block, re.S)
        return f.group(1) if f else ""

    books = []
    for block in page.split('class="gr_custom_each_container_"')[1:]:
        cover = re.search(r'<img alt="[^"]*" border="0" src="([^"]+)"', block)
        link = re.search(r'<a [^>]*href="([^"]+)"', field(block, "gr_custom_title_"))
        books.append({
            "title": " ".join(text_of(field(block, "gr_custom_title_")).split()),
            "author": " ".join(text_of(field(block, "gr_custom_author_")).removeprefix("by ").split()),
            "rating": block.count("gr_flat_red_star_active"),
            "review": text_of(field(block, "gr_custom_review_")),
            # Drop the thumbnail size suffix (e.g. "._SY75_") to get the full cover.
            "cover": re.sub(r"\._S[XY]\d+_(?=\.\w+$)", "", cover.group(1)) if cover else "",
            "link": link.group(1).split("?")[0] if link else "",
        })
    shelf = re.search(r'href="([^"]*review/list/[^"]*)"', page)
    return {"profile": shelf.group(1).split("&")[0].split("?")[0] if shelf else f"https://www.goodreads.com/user/show/{user_id}", "books": books}


MAX_NEWS = 8


def news(url, source):
    """Top headlines from an RSS feed, for the clock app on the 3D apartment's window.
    Handles digest feeds too (like Citadel Wire's hourly posts): when a post's body is a numbered
    list ("1. Headline" followed by "-- summary" lines), each numbered line becomes a headline,
    linked to that post, and posts without one (Citadel Wire's CODE WIRE release notes) are skipped."""
    root = ET.fromstring(get(url))
    plain, digest = [], []
    for item in root.iter("item"):
        link, published = item.findtext("link", "").strip(), iso(item.findtext("pubDate"))
        body = text_of(item.findtext("description", "") or "")
        heads = [m.group(1).strip() for m in re.finditer(r"^\s*\d+\.\s+(.+)$", body, re.M)]
        digest += [{"title": h, "link": link, "published": published} for h in heads]
        title = " ".join(text_of(item.findtext("title", "")).split())
        if title and not heads:
            plain.append({"title": title, "link": link, "published": published})
        if len(digest) >= MAX_NEWS:
            break
    return {"source": source or "News", "items": (digest or plain)[:MAX_NEWS]}


def featured_lists(username, slugs, old):
    """For the 3D theater's posters: each list's title, size and top 5 (from its page, in order), and a local copy
    of its #1 film's poster (from that film's page), fetched again only when the #1 changes."""
    out, before = [], {l["slug"]: l for l in (old or [])}
    folder = ROOT / "data" / "list-posters"
    folder.mkdir(parents=True, exist_ok=True)
    for slug in slugs:
        page = get(f"https://letterboxd.com/{username}/list/{slug}/").decode("utf-8", "replace")
        title = html.unescape((re.search(r'<meta property="og:title" content="([^"]+)"', page) or re.search(r"<title>(?:&lrm;)?([^<,]+)", page)).group(1)).strip()
        count = re.search(r"([\d,]+)\s*films", page)
        names = re.findall(r'data-item-name="([^"]+)"', page)[:5]
        links = re.findall(r'data-target-link="(/film/[^"]+)"', page)[:5]
        top = []
        for name, link in zip(names, links):
            name = html.unescape(name)
            m = re.match(r"(.*) \((\d{4})\)$", name)
            top.append({"title": m.group(1) if m else name, "year": m.group(2) if m else "", "link": "https://letterboxd.com" + link})
        entry = {"slug": slug, "title": title, "link": f"https://letterboxd.com/{username}/list/{slug}/",
                 "count": int(count.group(1).replace(",", "")) if count else len(top), "top": top, "poster": f"data/list-posters/{slug}.jpg"}
        img, prev = folder / f"{slug}.jpg", before.get(slug)
        if top and not (prev and prev.get("top") and prev["top"][0]["link"] == top[0]["link"] and img.exists()):
            film = get(top[0]["link"]).decode("utf-8", "replace")
            ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', film, re.S)
            poster = json.loads(re.sub(r"/\*.*?\*/", "", ld.group(1), flags=re.S)).get("image") if ld else None
            if poster:
                img.write_bytes(get(poster))
                print(f"letterboxd: saved the #1 poster for {title} ({top[0]['title']})")
        out.append(entry)
    return out


def save_now_showing(diary):
    """Keeps a local copy of the latest diary poster (data/now-showing.jpg) for the 3D house's
    theater screen: Letterboxd's image server doesn't allow other sites to draw its images in WebGL."""
    poster = diary[0].get("poster", "") if diary else ""
    mark, img = ROOT / "data" / "now-showing.txt", ROOT / "data" / "now-showing.jpg"
    if not poster or (mark.exists() and mark.read_text().strip() == poster and img.exists()):
        return
    img.write_bytes(get(poster))
    mark.write_text(poster + "\n")
    print("letterboxd: saved the latest poster for the house theater")


def save_latest_book(books):
    """Keeps a local copy of the latest Goodreads book cover (data/latest-book.jpg) for the copy lying on
    the 3D house's coffee table: like Letterboxd's, Goodreads' image server won't let other sites draw it in WebGL."""
    cover = books[0].get("cover", "") if books else ""
    mark, img = ROOT / "data" / "latest-book.txt", ROOT / "data" / "latest-book.jpg"
    if not cover or (mark.exists() and mark.read_text().strip() == cover and img.exists()):
        return
    img.write_bytes(get(cover))
    mark.write_text(cover + "\n")
    print("goodreads: saved the latest cover for the house coffee table")


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
            try:
                save_now_showing(lb["diary"])
            except Exception as e:
                print(f"letterboxd: couldn't save the latest poster ({e})", file=sys.stderr)
            slugs = [s.strip() for s in setting("theaterLists").split(",") if s.strip()]
            if slugs:
                try:
                    lb["featured"] = featured_lists(username, slugs, old.get("letterboxd", {}).get("featured"))
                    print(f"letterboxd: {len(lb['featured'])} featured lists for the theater")
                except Exception as e:
                    print(f"letterboxd: couldn't read the featured lists ({e}); keeping the last ones", file=sys.stderr)
                    if old.get("letterboxd", {}).get("featured"):
                        lb["featured"] = old["letterboxd"]["featured"]
        except Exception as e:  # keep the last good copy if the fetch fails
            failed = True
            print(f"letterboxd: fetch failed ({e}); keeping previous data", file=sys.stderr)
            if "letterboxd" in old:
                out["letterboxd"] = old["letterboxd"]
    else:
        print("letterboxd: no username set in content.js, skipping")

    user_id = setting("goodreads")
    if user_id:
        try:
            out["goodreads"] = goodreads(user_id)
            print(f"goodreads: {len(out['goodreads']['books'])} books")
            try:
                save_latest_book(out["goodreads"]["books"])
            except Exception as e:
                print(f"goodreads: couldn't save the latest cover ({e})", file=sys.stderr)
        except Exception as e:
            failed = True
            print(f"goodreads: fetch failed ({e}); keeping previous data", file=sys.stderr)
            if "goodreads" in old:
                out["goodreads"] = old["goodreads"]
    else:
        print("goodreads: no user ID set in content.js, skipping")

    news_url = setting("news")
    if news_url:
        try:
            out["news"] = news(news_url, setting("newsSource"))
            print(f"news: {len(out['news']['items'])} headlines")
        except Exception as e:
            failed = True
            print(f"news: fetch failed ({e}); keeping previous data", file=sys.stderr)
            if "news" in old:
                out["news"] = old["news"]
    else:
        print("news: no feed set in content.js, skipping")

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
