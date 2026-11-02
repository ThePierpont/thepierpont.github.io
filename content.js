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
  name: "Tyler",
  tagline: "I take photos, buy too many jackets, and keep a running log of whatever I'm into.",
  status: "Probably out shooting film",
  location: "Washington, DC",
  // Your time zone, for the live clock. Find yours at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
  timezone: "America/New_York",
  updated: "2026-11-01",
  portrait: "images/me.jpg",

  about: [
    "Hey, I'm Tyler. This is my corner of the internet: the photos I take, the clothes I'm wearing, the music on repeat, and whatever I'm watching.",
    "Write a couple of sentences here about what you do, where you're based, and what you'd want someone to know about you.",
  ],
  facts: [
    { k: "Based in", v: "Your City" },
    { k: "Camera", v: "Your camera" },
    { k: "Coffee order", v: "Your order" },
    { k: "Always down for", v: "Late-night food" },
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

  // Newest first.
  fits: [
    { src: "", item: "Black nylon bomber", brand: "Brand Name", date: "2026-10-20", tag: "Jacket", note: "Wore it four days straight. No regrets.", link: "" },
    { src: "", item: "Wide-leg denim", brand: "Brand Name", date: "2026-10-02", tag: "Pants", note: "Finally found a fit that works.", link: "" },
    { src: "", item: "Grey trail runners", brand: "Brand Name", date: "2026-09-15", tag: "Shoes", note: "Daily driver.", link: "" },
    { src: "", item: "Vintage band tee", brand: "Thrifted", date: "2026-08-29", tag: "Top", note: "$6. Best purchase of the year.", link: "" },
    { src: "", item: "Silver chain", brand: "Brand Name", date: "2026-08-10", tag: "Jewelry", note: "", link: "" },
  ],

  music: {
    // Paste a Spotify or Apple Music embed URL to show a player.
    // Spotify: open the playlist → Share → Embed playlist → copy the src="..." URL.
    playlistEmbed: "",
    // The first song shows as "Now playing" at the top of the site.
    tracks: [
      { src: "", title: "Sample Song One", artist: "Artist Name", note: "On repeat all week.", link: "" },
      { src: "", title: "Sample Song Two", artist: "Artist Name", note: "Night-drive song.", link: "" },
      { src: "", title: "Sample Song Three", artist: "Artist Name", note: "", link: "" },
      { src: "", title: "Sample Song Four", artist: "Artist Name", note: "Found it in a café.", link: "" },
      { src: "", title: "Sample Song Five", artist: "Artist Name", note: "", link: "" },
    ],
  },

  // type: "movie" or "show". status: "watching", "finished", "dropped" or "next".
  screen: [
    { src: "", title: "A Prestige Drama", type: "show", year: 2025, status: "watching", rating: 4, note: "Season 2, episode 5." },
    { src: "", title: "A Sci-Fi Movie", type: "movie", year: 2026, status: "finished", rating: 5, note: "Saw it twice in theaters." },
    { src: "", title: "An Old Favorite", type: "movie", year: 1982, status: "finished", rating: 5, note: "Rewatch every fall." },
    { src: "", title: "A Comedy Series", type: "show", year: 2024, status: "next", note: "Everyone keeps telling me to watch this." },
    { src: "", title: "An Indie Film", type: "movie", year: 2026, status: "finished", rating: 3, note: "Great score, slow middle." },
  ],

  // status: "reading", "finished" or "next".
  reading: [
    { title: "A Novel", author: "Author Name", status: "reading", note: "About a third in." },
    { title: "A Nonfiction Book", author: "Author Name", status: "finished", rating: 4, note: "" },
    { title: "Next on the List", author: "Author Name", status: "next", note: "" },
  ],

  // Short posts, newest first.
  log: [
    { date: "2026-11-01", title: "Site's live", body: "Built a little home for everything I'm into. More photos coming soon." },
    { date: "2026-10-18", title: "Film roll developed", body: "Half of them are blurry. The other half are the best I've taken." },
  ],

  contact: {
    email: "you@example.com",
    // Optional: create a free form at https://formspree.io and paste its URL here
    // (looks like https://formspree.io/f/abcdwxyz). Messages then land in your inbox.
    // Leave empty and the form opens the visitor's email app instead.
    formEndpoint: "",
  },

  // Live updates from other sites. Fill in your username and run
  // `python3 connectors/fetch_feeds.py` (or let the GitHub Action do it hourly).
  // Letterboxd: your diary entries and lists show up in the Watching section,
  // and your latest log takes over the "Watching" tile at the top.
  connectors: {
    letterboxd: "ThePierpont", // your Letterboxd username, e.g. "tyler" from letterboxd.com/tyler/
  },

  // Socials and other places to find you. Remove any you don't use.
  links: [
    { label: "Instagram", value: "@yourhandle", url: "https://instagram.com/" },
    { label: "Spotify", value: "Your profile", url: "https://open.spotify.com/" },
    { label: "Letterboxd", value: "@ThePierpont", url: "https://letterboxd.com/ThePierpont/" },
    { label: "TikTok", value: "@yourhandle", url: "https://tiktok.com/" },
  ],
};
