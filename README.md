# HerbWise AI

A medicinal plant explorer: search up to 500 plants with photos, save favourites, and ask an AI assistant (Claude) questions about any plant.

- **Frontend:** HTML/CSS/JavaScript, served by the backend
- **Backend:** Node.js + Express
- **Database:** SQLite (a single file, created automatically; no database server to install)
- **AI:** Anthropic Claude API (key goes in `.env`)

Frontend and backend run as ONE server, so there is just one thing to start.

## 1. Install the software (Windows)

1. **Node.js 20 LTS (or newer)**: https://nodejs.org (accept defaults). Check in a new terminal: `node -v`
2. **VS Code**: https://code.visualstudio.com
3. An **internet connection** (needed once to download packages and build the plant database).
4. An **Anthropic API key** (only for the AI chat): https://console.anthropic.com/ -> API Keys. The site works without it, but the chat will say AI is not configured.

## 2. Open the project

Extract `HerbWise-AI.zip`, then in VS Code: **File -> Open Folder...** -> choose the `HerbWise-AI` folder. Open a terminal with **Terminal -> New Terminal**.

## 3. Add your API key

1. Copy `.env.example` to a new file named `.env` (in VS Code: right-click `.env.example` -> Copy, then Paste and rename; or run `copy .env.example .env`).
2. Open `.env` and set: `ANTHROPIC_API_KEY=your-key-here`
3. Save. Never share this file.

## 4. Run it

**Easiest:** double-click `start.bat`.

**Manually, in the VS Code terminal:**

```
npm install
npm run seed
npm start
```

`npm run seed` builds the 1000-plant Indian medicinal database. It REQUIRES your `ANTHROPIC_API_KEY` and internet, takes roughly 30-60 minutes, and uses API credits (an estimated few dollars up to about ten). It is resumable: if it stops, run it again. To try it cheaply first, run `node scripts/seed.js 100` (100 plants), delete `data\seeded.flag` if present, and re-run the full seed later.

How the database is built: the AI lists Indian Ayurvedic species by category, then writes simple descriptions, uses, precautions and Hindi/Kannada names; photos and source links come from Wikipedia by scientific name. Duplicates are removed by scientific name (genus + species). Plants without a Wikipedia photo show a leaf placeholder.

**Updating from the previous version:** stop the server (Ctrl+C), keep your `.env`, extract the new ZIP over/into the project folder (or a new folder, then copy `.env` into it), and run `npm start` or `start.bat`. No new packages are needed. The old 500-plant table is removed automatically because it was mostly non-Indian species.

## 5. Open the website

**http://localhost:3000**

## Features

Language switcher (English / ಕನ್ನಡ / हिन्दी, saved in your browser; plant text is translated by the AI and cached), image upload with AI plant identification (JPG/PNG/WEBP, drag-and-drop, preview, remove), 1000-plant dashboard with filters, A-Z, search by English/Kannada/Hindi/scientific name or use, pagination, popular Ayurvedic plants, detail view with precautions and references, saved plants, and an AI chat.

## Accuracy

Plant information is AI-compiled and NOT yet reviewed by an expert against the AYUSH/NMPB/IMPPAT references; the site says so on every plant. Hindi/Kannada names especially should be checked. Traditional uses are kept separate from modern evidence.

## Troubleshooting

- **`node` is not recognized:** reinstall Node.js, then open a NEW terminal.
- **`npm install` fails on better-sqlite3:** make sure you use Node 20 LTS; otherwise install "Desktop development with C++" via Visual Studio Build Tools.
- **Seed says fewer than 500 plants:** Wikipedia had fewer qualifying pages (with image and description) in the categories searched. Run `npm run seed` again, or add more categories to the `ROOTS` list in `scripts/seed.js`.
- **Port in use:** change `PORT` in `.env`, and open that port instead.
- **AI errors:** check the key in `.env` and restart. `ANTHROPIC_MODEL` can be changed in `.env`.

## Important

Plant descriptions come from Wikipedia and are educational only. This is not medical advice; consult a qualified health professional before using any herbal product.
