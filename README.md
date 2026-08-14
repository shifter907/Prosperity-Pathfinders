# Prosperity & Pathfinders — Multiplayer

Web version of the Prosperity & Pathfinders investing & entrepreneurship board RPG.
Players share a session code, each manages **only their own** character ledger, and the
turn reconciles once everyone has marked themselves done.

Built on Cloudflare Workers with one Durable Object per session, so session state
persists indefinitely and updates stream live over WebSockets.

> The original single-device Android DM app lives in a separate repository and is
> unaffected by this project.

## How a game runs

1. Someone opens the site and **starts a session**, choosing a mode (below).
2. They share the 5-character code (or the invite link) with everyone else.
3. Each player joins, names a character, and picks a career + hobby.
4. Players take actions on their own ledger, then hit **Mark me done**.
5. When every *connected* player is done, the server draws a **random** market card,
   compounds every portfolio, settles salaries, housing, loans and rents, and advances
   the turn. Disconnected players never hold up the table.
6. The market card panel always shows the card applied **last** turn — on turn 1 it is
   deliberately empty, because nothing has happened yet.

### Session modes

| Mode | What it means |
| --- | --- |
| **Host has controls** | The creator plays a character *and* can change economic settings mid-game, force a stalled turn to reconcile, and remove a player. |
| **Equal players** | Nobody holds live controls. The creator sets the economy at creation time and it is locked for the session. |

In both modes the rule that you can only edit your own ledger is absolute — it is
enforced server-side, and even the host cannot touch another player's numbers.

### Session lifetime & the live board

A session's Durable Object re-arms a 7-day expiry alarm on every change. Seven days
after the *last* action — not since creation — it broadcasts a warning, disconnects
everyone, and permanently deletes its own storage. There is no manual "kill session"
control in the UI; a session either has recent activity or it cleans itself up.

The lobby's **Tables in play worldwide** board is fed by a single global
`SessionRegistry` Durable Object that every session reports to on join, presence
change, and turn advance (never on individual ledger actions, so it stays cheap).
"Live" means someone is currently connected; "open" means the session still exists.

## Architecture

```
src/worker.js            Routing: session API, WebSocket upgrade, static assets
src/session.js           GameSession Durable Object - authoritative state + turn engine
src/registry.js          SessionRegistry Durable Object - the live-sessions board
src/email.js             Gmail API save-file emailing
public/shared/engine.js  Game economics, shared by server and browser
public/index.html        Lobby: create / join, live sessions board
public/game.html         Session play screen
public/app.js            Client: WebSocket, rendering, action intents
public/vendor/           Tailwind + Lucide, served locally (no CDN dependency)
```

The Durable Object is the single source of truth. Clients send *intents*
(`buyAsset`, `borrow`, `payDebt`, …); every one is validated and applied server-side
against the caller's own player record, so a tampered client cannot edit someone
else's ledger or force the turn. `engine.js` is shared with the browser purely so
previews (loan payment, property quote) show the same numbers the server will use.

## Running locally

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:8787 (wrangler prints the port it chose).

## Deploying

```bash
npx wrangler login
npm run deploy
```

Durable Objects here use the SQLite storage backend (`new_sqlite_classes`), which is
available on the Workers free plan.

## Setting up "Email save" (optional)

The Export panel's Download button always works — it just serializes the state the
client already has. Email is optional and off by default (the button grays itself out
until it's configured); this is what turns it on.

**Why the Gmail API, not Cloudflare's `send_email` binding:** that binding can only
send to addresses already verified in your Cloudflare account. Sending to an arbitrary
address needs Cloudflare's Email Sending product, which requires a Workers **Paid**
plan and onboarding a domain with SPF/DKIM. The Gmail API needs neither — it sends
over plain HTTPS using a Gmail account you already control, on any Workers plan.

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)) — create or pick a project, then
   **APIs & Services → Library** → enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen** — User type **External**. Add the
   scope `https://www.googleapis.com/auth/gmail.send`. Add your own Gmail address as
   a test user, then **publish the app to Production**.
   > Skipping this and leaving it in "Testing" is the classic gotcha: Google expires
   > refresh tokens from unpublished apps after 7 days, so email would silently stop
   > working a week in. A single-user app with only the `gmail.send` scope does not
   > need Google's full verification review to run in Production — you'll just see a
   > one-time "Google hasn't verified this app" warning during setup, which is normal
   > and safe to click through since it's your own app on your own account.
3. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**,
   type **Web application**, add `https://developers.google.com/oauthplayground` as
   an authorized redirect URI. Note the **Client ID** and **Client secret**.
4. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) →
   gear icon (top right) → check **Use your own OAuth credentials** → paste the
   Client ID/secret from step 3.
5. In the left panel, enter the scope `https://www.googleapis.com/auth/gmail.send`,
   click **Authorize APIs**, and sign in as the Gmail account that should send these
   emails. Then click **Exchange authorization code for tokens** and copy the
   **Refresh token** it shows.
6. Decide the **From** address:
   - Simplest: the Gmail address itself (e.g. `tylersorensen22@gmail.com`) — no
     further setup.
   - An alias (e.g. `tyler@sorensencreative.com`): first set up Cloudflare **Email
     Routing** to forward that address to the Gmail account, then in Gmail
     **Settings → Accounts and Import → Send mail as → Add another email address**
     and verify it using the code Cloudflare routes through. Once verified, the
     Gmail API can send as that alias exactly like Gmail's own compose window can.
7. Set the four secrets:
   ```bash
   npx wrangler secret put GMAIL_CLIENT_ID
   npx wrangler secret put GMAIL_CLIENT_SECRET
   npx wrangler secret put GMAIL_REFRESH_TOKEN
   npx wrangler secret put GMAIL_SENDER
   ```
   Each prompts for the value with hidden input — nothing is echoed or logged.
8. Redeploy (`npm run deploy`). `GET /api/email-status` should now report
   `{"configured": true}` and the Email button will light up for players.

Each session self-limits to one email every 30 seconds to keep someone from
spamming the button; the recipient address is written into the session log only as
"emailed a save snapshot," not the address itself, to keep it private from the rest
of the table.

## Game model notes

The economics are ported from the Android build, including several corrections made
there:

- The primary residence (`homeValue`) is tracked separately from the residential
  *investment* bucket, so liquidating investments can never sell a player's own home.
- Investment-property loans amortize independently of the primary mortgage. Rolling
  them together starved the home payment and made the balance grow forever.
- A paid-off mortgage stops billing principal & interest.
- Overpaying debt only ever charges what actually retires debt.
- Every ledger input is parsed defensively, so a blank field reads as zero instead of
  poisoning a balance with `NaN`.

Salaries are **annual** ($60k–$90k by archetype) and halved for each 6-month turn.
