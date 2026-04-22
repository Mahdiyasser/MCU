# Contributing to MCU Universe

First off — thanks for wanting to help! The app, dashboard, and architecture are all done. What the project needs right now is people to help **verify the existing data** and **add the titles and cast members that are still missing** from the database.

---

## What needs to be done

### 1. Verify existing entries
All current entries have their data filled in, but it hasn't been fully verified for accuracy yet. Go through the titles and stars and cross-check against reliable sources, correcting anything that's wrong. This includes:

- Ratings (IMDb score, Rotten Tomatoes %, Metacritic)
- Box office numbers (budget, worldwide gross)
- Release dates, runtimes, directors, writers
- Cast lists and character names
- Synopses
- External links (IMDb, Wikipedia, Marvel.com, trailer)
- Star bios, birthdays, nationalities, social links

### 2. Add missing titles and stars
The database does not yet have every MCU title and cast member. If you know of a title (movie, Disney+ series, special presentation, or short) or a cast/crew member that's missing, add them through the dashboard.

---

## How to contribute

### 1. Fork & clone the repo

```bash
git clone https://github.com/Mahdiyasser/MCU ~/MCU-Project
cd ~/MCU-Project
```

### 2. Serve it locally with PHP

The admin dashboard needs PHP to run. Pick whichever option works for you:

**PHP built-in server** (easiest, no extra install if you already have PHP):
```bash
php -S localhost:8080
```
Then open `http://localhost:8080/admin/`

**XAMPP / WAMP / MAMP:** Copy the project folder into your `htdocs` (or `www`) directory and start Apache.

**Any other local PHP server** works fine too.

> The frontend app at `/app/` is pure static HTML/CSS/JS — you can preview it by just opening `app/index.html` in a browser without any server.

### 3. Use the admin dashboard

Go to `/admin/` on your local server. It's the **S.H.I.E.L.D. NEXUS** dashboard. It's designed to be self-explanatory — give yourself about 15 minutes to click around and you'll have a clear picture of how everything works.

- Use the **Titles** tab to verify and add MCU entries
- Use the **Stars** tab to verify and add cast & crew
- Everything saves directly to the JSON files in `/assets/`

### 4. Submit a pull request

Once you're done, commit the changed JSON files and open a pull request. Briefly describe what you verified, corrected, or added so it's easy to review.

---

## Guidelines

- **Use reliable sources.** IMDb, Wikipedia, Marvel.com, and Box Office Mojo are good references.
- **Correct, don't guess.** If you're not sure whether something is wrong, leave it as-is and mention it in the PR so it can be looked into.
- **Don't touch the app code** unless you're fixing a bug or have discussed a change first. Data contributions only need edits to the JSON files in `/assets/`.

---

## Want to collaborate more closely?

If you'd like to coordinate directly, discuss what to work on, or just get in touch:

- 🌐 [mahdiyasser.site/contact](https://mahdiyasser.site/contact)
- 📧 [mahdi@mahdiyasser.site](mailto:mahdi@mahdiyasser.site)

Don't hesitate to reach out — all help is appreciated.
---

*Last updated: 2026-04-22*
