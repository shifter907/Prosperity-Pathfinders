// A single global Durable Object that tallies sessions so the lobby can show a
// live board. Sessions report to it on meaningful events only (created, joined,
// presence change, turn, deleted) - never on every ledger action - so this one
// instance stays far away from being a throughput bottleneck.

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days since last change

export class SessionRegistry {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.sessions = null;
    }

    async load() {
        if (!this.sessions) {
            this.sessions = (await this.ctx.storage.get('sessions')) || {};
        }
        return this.sessions;
    }

    // Sessions expire on their own alarm; this only drops stale bookkeeping in case
    // a session's delete notification never arrived (e.g. it was wiped externally).
    prune(sessions) {
        const cutoff = Date.now() - SESSION_TTL_MS;
        let changed = false;
        for (const [code, info] of Object.entries(sessions)) {
            if (!info || (info.lastActivity || 0) < cutoff) {
                delete sessions[code];
                changed = true;
            }
        }
        return changed;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const sessions = await this.load();

        if (url.pathname === '/report') {
            const { code, players, connected, turn, deleted } = await request.json();
            if (deleted) {
                delete sessions[code];
            } else {
                sessions[code] = {
                    lastActivity: Date.now(),
                    players: Number(players) || 0,
                    connected: Number(connected) || 0,
                    turn: Number(turn) || 1
                };
            }
            this.prune(sessions);
            await this.ctx.storage.put('sessions', sessions);
            return Response.json({ ok: true });
        }

        if (url.pathname === '/stats') {
            if (this.prune(sessions)) await this.ctx.storage.put('sessions', sessions);
            const all = Object.values(sessions);
            const live = all.filter(s => s.connected > 0);
            return Response.json({
                // "Live" means at least one player is connected right now.
                liveSessions: live.length,
                playersOnline: live.reduce((t, s) => t + s.connected, 0),
                // "Open" means the session still exists and has not expired.
                openSessions: all.length,
                charactersInPlay: all.reduce((t, s) => t + s.players, 0),
                turnsInProgress: all.reduce((t, s) => t + Math.max(0, s.turn - 1), 0)
            });
        }

        return new Response('Not found', { status: 404 });
    }
}
