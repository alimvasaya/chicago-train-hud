# Chicago Train HUD — Setup Guide (Meta Ray-Ban Display)

This is a real, working web app for the **Meta Ray-Ban Display** glasses. It shows
live CTA 'L' and Metra arrivals for the station nearest to you. It is built against
Meta's actual Web Apps platform (opened May 14, 2026) — standard HTML/CSS/JS,
600×600 display, arrow-key/Enter navigation, and the phone's GPS.

## What's in this folder

| File | What it does |
|------|--------------|
| `index.html`, `styles.css`, `app.js` | The glasses app (the screen you see) |
| `api/trains.js` | A small server that talks to CTA + Metra and hides your API keys |
| `package.json` | Lists the one library the server needs |
| `icon-96.png` | The app icon Meta shows |

Everything deploys as **one** project. You do **not** need a separate proxy
project (that's what kept failing before).

---

## Step 1 — Get your free API keys

**CTA (required):** Go to https://www.transitchicago.com/developers/ttdocs/ and
request a Train Tracker API key. It arrives by email, usually fast.

**Metra (required for Metra times):** Go to https://metra.com/developers, agree to
the GTFS-Realtime license, and request an API key (`api_token`). Their docs will
give you the current real-time feed URL — the old `gtfsapi.metrarail.com` address
was retired on **Nov 1, 2025**, so use whatever host their approval email lists.

> If you only have the CTA key for now, the app still works — Metra stations will
> just show "No upcoming trains" until you add the Metra key.

## Step 2 — Put the project on GitHub

1. Create a new, empty repository on GitHub (e.g. `chicago-train-hud`).
2. Upload **all** the files in this folder, keeping the `api/` folder intact.
   (On github.com: "Add file" → "Upload files" → drag the whole folder in.)

## Step 3 — Deploy to Vercel (one project)

1. Go to https://vercel.com/new and import your new GitHub repo.
2. **Framework Preset: "Other".** Leave the Build Command and Output Directory
   **blank.** Do not pick Express/Node — that's what caused the
   "No entrypoint found" error before. Vercel automatically serves your HTML and
   automatically turns `api/trains.js` into a live endpoint. No `vercel.json` needed.
3. Before clicking Deploy, open **Environment Variables** and add:
   - `CTA_KEY` = your CTA key
   - `METRA_TOKEN` = your Metra api_token  *(skip if you don't have it yet)*
   - `METRA_RT_URL` = the Metra real-time trip-updates URL from their docs *(skip if no Metra)*
4. Click **Deploy**. You'll get a URL like `https://chicago-train-hud.vercel.app`.

## Step 4 — Test it in a normal browser first

Open your Vercel URL on your phone or laptop and tap **Find my trains**, then allow
location. You should see the nearest station and live arrivals. You can also test
the data layer directly by visiting:

```
https://YOUR-URL.vercel.app/api/trains?lat=41.8857&lon=-87.6309
```

That should return JSON with arrivals for Clark/Lake. If it does, the hard part is done.

## Step 5 — Load it on the glasses

1. Register as a wearables developer at https://developer.meta.com/wearables
   (the Web Apps developer preview is rolling out over the coming weeks — if it's
   not available to your account yet, that's a Meta-side gate, not your app).
2. Follow the **Web Apps → Test** instructions in Meta's docs
   (https://wearables.developer.meta.com/docs/develop/webapps/test/) to add your
   Vercel URL and open it on the glasses.
3. On the glasses, use the Neural Band / temple swipes to move the highlight
   between buttons and pinch/tap to select (these map to arrow keys + Enter).

---

## Important honest notes

- **Station list is a starter set.** `api/trains.js` includes ~13 major CTA + Metra
  stations so it works right away. The CTA station IDs (`mapid`) are the well-known
  hubs; verify and expand them from the official CTA "L stops" dataset. The Metra
  `stop_id` values are **placeholders** — replace them with real IDs from Metra's
  current GTFS static feed, or Metra arrivals won't match.
- **Metra endpoint** is set via the `METRA_RT_URL` env var on purpose, because the
  exact host changed in late 2025. Use the one in your Metra approval docs.
- **No proprietary SDK.** Earlier code imported `cdn.meta.com/rayban-display-sdk` —
  that doesn't exist. This version uses only standard web APIs, which is what the
  glasses actually run.
