# NJT Maplewood Train App

Real-time NJ Transit train schedule for Maplewood Station ↔ NY Penn Station.

## Setup on Netlify

### 1. Create a GitHub repo
- Go to github.com → New repository → name it `njt-maplewood`
- Upload ALL the files in this folder (index.html, package.json, netlify.toml, and the netlify/ folder)

### 2. Connect to Netlify
- Go to app.netlify.com → "Add new site" → "Import an existing project"
- Connect your GitHub account and select the `njt-maplewood` repo
- Leave build settings as default, click "Deploy site"

### 3. Add your NJT API credentials
- In Netlify, go to: Site settings → Environment variables
- Add two variables:
  - `NJT_USERNAME` → your NJ Transit developer portal username
  - `NJT_PASSWORD` → your NJ Transit developer portal password
- Go to Deploys → click "Trigger deploy" → "Deploy site"

### 4. Add to iPhone home screen
- Open your site URL in Safari
- Tap Share → "Add to Home Screen"

## How it works
- Static schedule is hardcoded in index.html (always works)
- A Netlify Function calls the NJT GTFS-RT API every 30 seconds for live delay data
- If the API is unavailable, it gracefully falls back to the static schedule
- GPS determines which direction to show by default
