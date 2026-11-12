# Project H.E.R. Website

Responsive single-page website for Project H.E.R. The page editor supports text, photos, colors, layout changes, and browser-local saves.

## Run locally

Open `index.html` in a browser. Keep `assets/project-her-logo.jpeg` beside it in the `assets` folder. Local browser edits are stored in local storage and do not sync to GitHub.

## Automatic GitHub sync

See [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) for one-time Cloudflare Worker and GitHub token setup. The Worker serves the latest GitHub page and commits editor changes after a short pause.

The GitHub token belongs in a Cloudflare Worker secret. Never put it in this repository or the page source.

