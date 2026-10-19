# Volunteer Merit Studio AI Worker

Cloudflare Worker serving the public AI draft API. The app remains on GitHub Pages; the Worker only receives approved activity area, description, date, hours, and category.

## Deploy

1. Sign in to Cloudflare, install the workspace dependencies with `pnpm install`, then deploy with `pnpm --dir worker deploy`. It creates the `volunteer-merit-studio-ai` Worker and prints its `workers.dev` URL.
2. In the project folder, run `pnpm --dir worker exec wrangler secret put OPENAI_API_KEY`, then `pnpm --dir worker exec wrangler secret put APP_ACCESS_CODE`. Wrangler prompts for each secret. Use a private code of at least 12 characters. Never put either value in `wrangler.toml`, `api-config.js`, GitHub, or chat.
3. Set the Worker origin (the base URL without a path) as `window.MERIT_API_URL` in the root `api-config.js`, then publish the GitHub Pages update.

`APP_ORIGIN` in `wrangler.toml` restricts browser requests to the public GitHub Pages origin. The shared access code is held only in the current browser tab's session storage. The Worker never sends the OpenAI key to the browser.
