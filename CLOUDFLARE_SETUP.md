# Turn on automatic GitHub sync

The website can save edits straight to the private `niyati0830/Project-HER-` repository. Cloudflare Worker serves the website and keeps the GitHub token on the server. The token is never put into `index.html` or sent to the browser.

## 1. Create a limited GitHub token

Create a **fine-grained personal access token** for only `Project-HER-`:

- Repository access: **Only select repositories** → `Project-HER-`
- Repository permissions: **Contents: Read and write**
- Set an expiration date

GitHub creates the token. Keep it private; do not paste it into the website or chat.

## 2. Deploy the Worker

Install Node.js if needed, open a terminal in this folder, and run:

```powershell
npx wrangler login
npx wrangler deploy
```

This creates the Worker at a `workers.dev` address. The first deployment will show an error page until the three secrets below are added.

## 3. Add the three Cloudflare secrets

Run each command and paste its value only into the secure terminal prompt:

```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SYNC_PASSWORD
npx wrangler secret put SESSION_SECRET
```

- `GITHUB_TOKEN`: the fine-grained token from step 1.
- `SYNC_PASSWORD`: create a long, unique password. You will enter this in the website’s GitHub sync box.
- `SESSION_SECRET`: create a different random secret of at least 32 characters.

Each command deploys the secret to Cloudflare. Once all three are set, open the Worker’s `workers.dev` URL.

## 4. Connect the page editor

Click **Edit this page**, enter the `SYNC_PASSWORD`, and click **Connect**. After that, edits save locally and sync to GitHub shortly after you pause editing. The Worker serves the latest `index.html` from GitHub, so reloading the site shows the committed version.

The editor keeps a local browser copy too. If GitHub sync fails, the status in the editor will say so; use **Sync now** after reconnecting.

## Deploying Worker code changes

After changing `worker.js` or `wrangler.jsonc`, run `npx wrangler deploy` again. Normal page edits update the GitHub file without needing a Worker redeploy.

