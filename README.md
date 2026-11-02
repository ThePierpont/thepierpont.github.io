# Tyler // Personal Grid

A one-page personal site: about, photos, fits, music, what you're watching, reading, a short log, and contact.

## Editing

Open `content.js`. Everything on the page comes from that one file. Change it, save, and refresh.

- **Photos and images:** put files in `images/` and set `src: "images/name.jpg"`. Items without a `src` show a neon placeholder tile.
- **Hide a section:** empty its list (for example `reading: []`) and it disappears, along with its menu link.
- **Music player:** paste a Spotify or Apple Music embed URL into `music.playlistEmbed`.
- **Contact form:** with `formEndpoint` empty, the form opens the visitor's email app. For messages straight to your inbox, make a free form at formspree.io and paste its URL.

## Connectors (live updates from other sites)

The site can pull in what you do elsewhere. Right now that's **Letterboxd**: films you log show up as "Recently logged on Letterboxd" in the Watching section, with your rating, likes, rewatches, and review text, plus any lists you make. Your latest log also takes over the "Watching" tile at the top.

1. In `content.js`, set `connectors.letterboxd` to your username (the part after `letterboxd.com/`).
2. Open Terminal in this folder and run `python3 connectors/fetch_feeds.py`. It saves your latest activity to `data/feeds.json`.
3. Refresh the site.

**Keeping it updated automatically:** if the site lives on GitHub (GitHub Pages, or Netlify connected to GitHub), the included workflow at `.github/workflows/update-feeds.yml` re-runs the fetcher every hour and commits any new activity, so new logs appear on the site within about an hour with nothing for you to do. To run it right away, open the repo's **Actions** tab → **Update feeds** → **Run workflow**.

If you use Netlify Drop instead, run step 2 before each drag-and-drop.

Letterboxd's public feed covers your last 50 or so diary entries, reviews, and lists. Private activity never appears in it.

## Preview

Run `python3 -m http.server` in this folder and open http://localhost:8000. Double-clicking `index.html` also works, but connector data won't load that way, because browsers block local files from reading other files.

## Put it online (free)

Any static host works. The simplest options:

- **Netlify Drop:** go to app.netlify.com/drop and drag this folder onto the page.
- **GitHub Pages:** push the folder to a repo, then Settings → Pages → deploy from the main branch.
- **Firebase Hosting:** same steps as the chore board, in a separate Firebase project.
