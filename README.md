# 🦸 MCU Universe

**The Ultimate Marvel Tracker** — a personal MCU progress tracker and database explorer, hosted at [mcu.mahdiyasser.site](https://mcu.mahdiyasser.site).

> ⚠️ **Data Status (as of 2026-04-22):** The project's UI, UX, admin dashboard, and architecture are fully complete. The data that is currently in the database has not been fully verified yet, and there are also MCU titles and cast members that are still missing from the database entirely. Work on verifying and completing the data is now actively in progress — contributors are very welcome (see [Contributing to the Data](#-contributing-to-the-data) below).

---

## What is this?

MCU Universe is a personal watchlist and progress tracker for the entire Marvel Cinematic Universe. It covers all 62 titles across 6 phases — movies, Disney+ series, special presentations, and shorts — and lets you track what you've watched, build a wishlist, explore cast & crew, and earn XP as you go. Everything runs in the browser with no account or login required.

---

## Features

### 🎬 Complete MCU Database
All 62 MCU titles are catalogued across 6 Phases and 2 Sagas (The Infinity Saga and The Multiverse Saga), including released titles and upcoming ones. Each entry includes a poster, release year, type (Movie / Series / Special / Short), synopsis, cast, ratings (IMDb, Rotten Tomatoes, Metacritic), box office numbers, director, writer, genres, runtime, in-universe year, post-credit scene count, trailer links, and where to watch it.

### 📋 Two Watch Orders
Switch between **Release Order** (the order titles came out, recommended for first-timers) and **In-Universe Chronological Order** (the order events happen in the Marvel timeline, great for re-watches). Both orders are fully supported across all views.

### ✅ Watch Tracking & Wishlist
Mark any title as watched with a single tap. Add upcoming or unwatched titles to a wishlist to remind yourself what to watch next. Both lists are saved locally in your browser so your data is always there when you come back.

### 🏆 XP & Rank System
Earn XP as you watch. Every title gives you 30 XP, with bonus XP for completing a Phase, completing a full Saga, and unlocking Achievements. Your rank starts at **Civilian** and climbs through 11 tiers — Recruit, S.H.I.E.L.D. Agent, Avenger, Hero, Superhero, Guardian, Champion, Infinity Stone Holder, Sorcerer Supreme — all the way to **Multiversal Legend**.

### 🎖️ Achievements
24 achievements to unlock, including franchise-specific ones (Iron Man Trilogy, God of Thunder, Wakanda Forever, Friendly Neighborhood, etc.), milestone ones (Halfway There, True Believer for watching everything), and saga completion badges. Each achievement awards bonus XP.

### 🌟 Stars (Cast & Crew)
Browse 74 cast and crew members with headshots, character names, bios, nationality, age, social media links (Instagram, Twitter/X, Facebook), IMDb and Wikipedia links, and a list of all their MCU appearances. Clicking an appearance takes you straight to that title's detail page.

### 🔍 Global Search
Search both titles and cast members from the header. Results appear instantly as you type and are separated by type (Movie, Series, Special, Star).

### 👤 User Profile & Avatars
Create a personal profile with your name and choose from 30 character avatars (Iron Man, Thor, Black Panther, Loki, Scarlet Witch, and many more). Your profile shows your rank, level, total XP, watched count, wishlist count, and achievements earned.

### 🔗 Share & Import
Share your MCU journey with anyone via a shareable link — they can view your progress in read-only mode. You can also generate a **Copy Profile link** to import your exact profile (watch history, wishlist, avatar) onto another device, making it easy to sync between your phone and computer.

### 🗺️ Journey Tab
A dedicated progress hub showing your XP bar, rank, detailed stats (total time watched in hours, movies vs series breakdown, bonus XP, etc.), all achievements with their unlock status, and a full ordered watch queue grouped by Phase so you can see exactly what's next.

### 📌 Watchlist Tab
A dedicated tab showing everything you've wishlisted, so you can keep track of what you plan to watch.

### 🏠 Home Tab
An at-a-glance home screen with your overall progress stats, a Phase overview showing per-phase completion percentages, a "Currently Watching" strip (the next unwatched titles in your queue), and an Upcoming section showing future MCU releases.

### 🔗 Deep Linking & Browser Navigation
Every modal, tab, and search query is reflected in the URL. You can share a direct link to a specific title or cast member, and the browser's back/forward buttons work as expected.

### ⚡ Performance
All posters, star photos, and avatars are preloaded during the loading screen so browsing feels instant. Images are cached for 20 minutes with a smart cache-busting system that survives page reloads. Triple-clicking the logo clears the image cache if you ever need a fresh load.

---

## The Admin Dashboard (S.H.I.E.L.D. NEXUS)

The project includes a full-featured database management dashboard at `/admin/`, built in PHP and JavaScript. It's designed to be self-explanatory — anyone familiar with the MCU can sit down and understand it in about 15 minutes.

### Dashboard Tabs

- **Titles** — View, search, add, edit, and delete all MCU entries. Full form with every field: title, type, phase, release date, synopsis, ratings, box office, cast, links, poster image upload, and more. Includes a raw JSON editor per entry for advanced edits.
- **Stars** — View, search, add, edit, and delete cast & crew members. Edit bio, character, social links, IMDb/Wikipedia links, photo upload, and link their MCU appearances.
- **Reorder** — Drag-and-drop interface to manage both Release Order and Chronological Order arrays.
- **Bulk Reorder** — A mapper that lets you assign many titles to order positions at once, useful when adding a batch of new entries.
- **Settings** — Edit global metadata (phases, sagas, universe info, streaming platforms) and the raw order arrays directly.
- **JSON Editor** — A full raw editor for `mcu.json`, `stars.json`, and `data.json` for when you need direct access.
- **Overview** — A stats dashboard showing counts, phase breakdowns, and database health at a glance.

### Real-Time Collaboration
The dashboard uses **Server-Sent Events (SSE)** so multiple contributors can work on the dashboard simultaneously. When one person saves a change, all other open dashboards automatically reload the affected data in the background — no full page refresh, no lost work, and a conflict notification if someone else edited the item you currently have open.

### Safe Writes
All JSON file writes use atomic operations (write to a temp file, then rename) with exclusive file locking, so a crash or simultaneous save never corrupts the database.

---

## Project Structure

```
.
├── admin/
│   ├── index.php       ← S.H.I.E.L.D. NEXUS dashboard (PHP backend + API)
│   ├── script.js       ← Dashboard JavaScript
│   └── style.css       ← Dashboard styles
├── app/
│   ├── index.html      ← Main app HTML
│   ├── script.js       ← App JavaScript
│   └── style.css       ← App styles
├── assets/
│   ├── app/
│   │   ├── app.json    ← App config (XP values, ranks, achievements, avatars, colors)
│   │   └── avatars/    ← 30 character avatar images
│   ├── data.json       ← Universe metadata (phases, sagas, streaming platforms)
│   ├── mcu.json        ← All MCU entries (titles, cast, ratings, etc.)
│   ├── stars.json      ← All cast & crew entries
│   ├── image-archive.md← Auto-generated image registry
│   └── images/
│       ├── mcu/        ← 62 title posters
│       ├── stars/      ← 74 cast & crew headshots
│       └── platforms/  ← Streaming platform logos
├── index.html          ← Redirects to /app/
├── CNAME               ← GitHub Pages custom domain
└── LICENSE
```

---

## 🤝 Contributing to the Data

The database architecture, admin dashboard, and app are all done. What's missing is the actual content — synopses, full cast lists, ratings, box office numbers, external links, and more for many of the 62 titles and 74 stars.

**Contributors who want to help fill in and verify the data are very welcome.**

All you need to do is clone the repo, run it on a local web server (so the PHP dashboard works), and use the admin dashboard to edit entries. The dashboard is straightforward enough that you can figure it out on your own in about 15 minutes — no documentation needed.

### Getting Started

**1. Clone the repository:**
```bash
git clone https://github.com/Mahdiyasser/MCU ~/MCU-Project
```

**2. Serve it with a local PHP web server.** You can use any of these:

- **PHP built-in server** (simplest, no install needed if you have PHP):
  ```bash
  cd ~/MCU-Project
  php -S localhost:8080
  ```
  Then open `http://localhost:8080/admin/`

- **XAMPP / WAMP / MAMP** — copy the project folder into your `htdocs` (or `www`) directory and start Apache.

- **Laravel Hive / Laragon / Valet** — any local PHP server works.

**3. Open the admin dashboard** at `/admin/` on your local server.

**4. Start editing.** The dashboard is self-explanatory. Pick a title or a star, fill in whatever data you have, and save. Changes write directly to the JSON files in `/assets/`.

**5. Submit a pull request** with your updated JSON files.

> The app itself (the `/app/` frontend) is pure HTML/CSS/JS and doesn't need PHP — you can preview it by just opening `app/index.html` directly in a browser or via any static server.

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, and JavaScript — no frameworks, no build step.
- **Backend (admin only):** PHP for the API (file reads/writes, SSE, image uploads).
- **Data:** JSON files (`mcu.json`, `stars.json`, `data.json`, `app.json`).
- **Hosting:** GitHub Pages with a custom domain (`mcu.mahdiyasser.site`).

---

## License

See [LICENSE](./LICENSE) for details.

---

*Built by [Mahdi Yasser](https://github.com/Mahdiyasser)*
---

*Last updated: 2026-04-22*
