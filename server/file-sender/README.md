# Big file sender: intro server

Orbit's big file sender sends files straight from one computer to another. This tiny server only
introduces the two computers to each other. It never sees the file, and it can't read the
setting-up messages either (they're locked with the words in the code, which never leave the two
computers). It runs on Cloudflare's free plan.

## Set it up (about 10 minutes, once)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js.

1. In a terminal, in this folder (`server/file-sender`):

   ```
   npx wrangler login
   npx wrangler deploy
   ```

   It prints an address like `https://orbit-file-sender.<your-name>.workers.dev`.

2. **The relay (recommended).** Some home routers, phone hotspots and school or uni Wi-Fi stop
   two computers connecting directly. The relay passes the (still locked) file through Cloudflare
   instead. It's free for the first 1,000 GB a month, then $0.05 per GB.

   - In the Cloudflare dashboard, open **Realtime → TURN Server** and **Create**. Copy the
     **Turn Token ID** and the **API Token**.
   - Back in the terminal:

     ```
     npx wrangler secret put TURN_KEY_ID
     npx wrangler secret put TURN_KEY_API_TOKEN
     ```

     paste each when asked.

3. In Orbit, open **Big file sender**, paste the address into **Intro server**, and press **Save**.
   Orbit checks it and says whether the relay is on.

Your friend's Orbit needs the same address. Send it to them once (it isn't secret); they paste it
into the same box.

## What it does

- `GET /health`: says it's working and whether the relay is set up.
- `GET /room/<4-digit number>?as=host|guest` (WebSocket): the sender waits as `host`, the friend
  joins as `guest`; messages from one are passed to the other. One of each per room; a second
  sender gets `taken`, a friend with no sender waiting gets `nohost`, a third person gets `full`.
