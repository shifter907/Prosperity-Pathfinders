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

## Architecture

```
src/worker.js            Routing: session API, WebSocket upgrade, static assets
src/session.js           GameSession Durable Object - authoritative state + turn engine
public/shared/engine.js  Game economics, shared by server and browser
public/index.html        Lobby: create / join
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
