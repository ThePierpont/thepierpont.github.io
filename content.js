/*
  ============================================================
  >> CONTENT FILE: this is the only file you need to edit.
  ============================================================
  Everything on the site comes from here. Change the text, add or
  remove items, save, and refresh the page.

  Images: drop files into the `images/` folder and set
  `src: "images/your-file.jpg"`. Leave `src` empty and the site draws
  a neon placeholder until you add one.

  The "Right now" board at the top fills itself in from the lists below:
  the first song, newest photo, first show marked "watching", newest
  pickup, the book you're reading, and the newest note. Keep lists
  newest-first.

  Dates use YYYY-MM-DD. Ratings are 1 to 5.
  Everything below is sample content. Swap it for your own.
*/

window.SITE = {
  name: "Pierpont",
  tagline: "How am I doing? Scroll to find out",
  // Shown until you set a live status. To change it from the site itself, click the
  // blue dot next to your status (your Nostr signer is the password; see `nostr` below).
  status: "Work",
  location: "DC",
  // Your time zone, for the live clock. Find yours at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
  timezone: "America/New_York",
  updated: "2026-11-01",
  portrait: "images/me.jpg",

  about: [
    "A Mainer, Bitcoiner, movie lover, photo taker, and drink maker.",
  ],
  // Add `url` to any fact to make it a link.
  facts: [
    { k: "From", v: "Maine" },
    { k: "Based in", v: "DC" },
    { k: "Stacking", v: "Bitcoin" },
    { k: "Shooting on", v: "iPhone 17 Pro + film camera" },
    { k: "Making", v: "Drinks at PubKey DC", url: "https://dc.pubkey.com/" },
  ],

  // Newest first. The first one shows as "Latest photo" at the top.
  // Set `ratio` (like "3/2" or "4/5") only for placeholders; real photos use their own shape.
  photos: [
    { src: "images/archives-fountain.jpg", caption: "Fountain at the Archives", place: "Washington, DC", date: "2026-11-01" },
    { src: "images/old-post-office-tower.jpg", caption: "Old Post Office, last light", place: "Washington, DC", date: "2026-11-01" },
    { src: "images/penn-ave-fall.jpg", caption: "Fall on Pennsylvania Ave", place: "Washington, DC", date: "2026-11-01" },
    { src: "images/blue-hour-concrete.jpg", caption: "Brutalism and blue sky", place: "Washington, DC", date: "2026-11-01" },
    { src: "images/bar-crowd.jpg", caption: "Halloween crowd", place: "Washington, DC", date: "2026-10-31" },
    { src: "images/steeple-night.jpg", caption: "Steeple, overcast night", place: "Washington, DC", date: "2026-10-29" },
    { src: "images/before-doors.jpg", caption: "Lighting candles before doors", place: "", date: "2026-09-22" },
    { src: "images/behind-the-mic.jpg", caption: "Behind the mic", place: "", date: "2026-09-12" },
    { src: "images/cactus-nap.jpg", caption: "Nap with the cactus", place: "Home", date: "2026-09-11" },
    { src: "images/wedding-us.jpg", caption: "Wedding guests", place: "", date: "2026-09-05" },
    { src: "images/wedding-mom.jpg", caption: "Suited up", place: "", date: "2026-09-05" },
    { src: "images/yawn.jpg", caption: "Mid-yawn", place: "Home", date: "2026-07-27" },
    { src: "images/movie-night.jpg", caption: "Projector movie night", place: "Home", date: "2026-06-15" },
  ],

  // Newest first. The first one shows as "Newest pickup" at the top.
  fits: [
    { src: "images/closet-seafarer-rib-crew.jpg", item: "Seafarer Cotton Rib Crew", brand: "Buck Mason, Faded Indigo", date: "2026-11-01", tag: "Sweater", note: "", link: "https://www.buckmason.com/products/faded-indigo-seafarer-cotton-rib-crew" },
  ],

  // Live music from Last.fm: the "Now playing" tile shows what you're playing right now
  // (or last played), and "On repeat" lists your most-played tracks this week.
  // The API key is read-only and safe to be public. Get one at https://www.last.fm/api/account/create
  lastfm: {
    user: "thepierpont",
    apiKey: "22364379ea9bb333e26406a14d03c7ab",
  },

  music: {
    // Optional: paste a Spotify or Apple Music embed URL to show a player next to your top tracks.
    // Spotify: open the playlist → Share → Embed playlist → copy the src="..." URL.
    playlistEmbed: "",
    // Used only if Last.fm isn't set up. The first song shows as "Now playing".
    // { src: "", title: "Song", artist: "Artist", note: "", link: "" }
    tracks: [],
  },

  // Bitcoin strip on the "Right now" board: block height, price, fees, halving countdown.
  // Live from mempool.space, no account needed. currency: USD, EUR, GBP, CAD, CHF, AUD or JPY.
  bitcoin: {
    show: true,
    currency: "USD",
  },

  // TV from Trakt: shows you've watched (latest episode), what's on right now, and your
  // watchlist. Make your Trakt profile public, then add your username and Client ID.
  // The Client ID is read-only and safe to be public. Get one at https://trakt.tv/oauth/applications/new
  trakt: {
    user: "",
    clientId: "",
  },

  // Optional hand-entered titles, shown alongside Trakt and Letterboxd.
  // type: "movie" or "show". status: "watching", "finished", "dropped" or "next".
  // { src: "", title: "Severance", type: "show", year: 2022, status: "watching", rating: 5, note: "Season 2." }
  screen: [],

  // Your Goodreads books fill this in automatically (see `connectors` below). Hand-entered
  // books show only if Goodreads isn't set up. status: "reading", "finished" or "next".
  // { title: "Kitchen Confidential", author: "Anthony Bourdain", status: "reading", note: "" }
  reading: [],

  // Your latest Nostr posts fill the Notes section automatically (replies are skipped).
  // Anything added here shows only if Nostr can't be reached. Newest first:
  // { date: "2026-11-01", title: "Site's live", body: "Built a little home for everything I'm into." },
  log: [],

  // Your Nostr account. Paste your npub (starts with "npub1"). This adds a "Find me on
  // Nostr" link with your profile picture and name, and turns on the live status:
  // only someone who can sign as this npub (you, with a Nostr signer extension or app)
  // can change it. Statuses also sync with Nostr apps that show them (Damus, Amethyst, Nostrudel).
  nostr: {
    npub: "npub1nqvuy0k8vk8yt8sm549gehsuukjevqw3pjvem29yncvj94l82t7s5ddrp8",
    // Your own relays first (purplepag.es holds your profile), then two big public ones.
    relays: ["wss://relay.primal.net", "wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"],
    // Every image you've posted on Nostr goes on the photo wall. To keep older ones off,
    // set a start date here, e.g. "2026-11-01". Empty = your whole history.
    photosSince: "",
    // Nostr images to leave off the photo wall, e.g. copies of photos already in `photos` above.
    // Paste the image address (or just the long code in it). Copies of the same file are skipped automatically.
    hidePhotos: [
      "25f104d6bad39c9ca2d59dd333caf838cb34bfb2c13f9880edad30dbb2b771b0", // = Old Post Office, last light
      "beada64ba8b0c9a5898aec0eeb455265a72d004df0ff95b4bbb297bf290687e9", // = Brutalism and blue sky
      "ccb36b7cf4e81df627fbb104bcb1eaba7a0b1a2319149fc35c7043df29d13655", // = Fall on Pennsylvania Ave
      "20a0173c0ebcea9b0f282da087f1f951442adec00679a08d6949f2b088991f34", // = Fountain at the Archives
    ],
  },

  // Guestbook: visitors sign a short note with their own Nostr account (a Nostr comment on
  // this site's address, so it doesn't spam anyone's feed). You get notified on Primal.
  guestbook: {
    show: true,
    url: "https://pierpont.blog/",
    // To remove an entry, paste its note ID (note1… or nevent1…) here. Paste an npub to hide everything from that person.
    hide: [],
  },

  contact: {
    // Leave empty to hide the email link and message form (Nostr becomes the way to reach you).
    email: "",
    // Optional: create a free form at https://formspree.io and paste its URL here
    // (looks like https://formspree.io/f/abcdwxyz). Messages then land in your inbox.
    // Leave empty and the form opens the visitor's email app instead.
    formEndpoint: "",
  },

  // Live updates from other sites. Fill in your username and run
  // `python3 connectors/fetch_feeds.py` (or let the GitHub Action do it hourly).
  // Letterboxd: your diary entries and lists show up in the Watching section,
  // and your latest log takes over the "Watching" tile at the top.
  // Goodreads: your recent books fill the Reading section. It uses Goodreads' official
  // widget, so which shelf and how many books come from your widget settings on Goodreads.
  connectors: {
    letterboxd: "ThePierpont", // your Letterboxd username, e.g. "tyler" from letterboxd.com/tyler/
    goodreads: "200617598", // the number in your Goodreads profile URL
  },

  // Other places to find you, shown under your name and in Say hi. Example:
  // { label: "Letterboxd", value: "@ThePierpont", url: "https://letterboxd.com/ThePierpont/" }
  links: [],
};
