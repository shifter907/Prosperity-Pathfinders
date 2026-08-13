// Cloudflare Worker entry point.
//
// Routing:
//   POST /api/session          -> create a new session, returns its join code
//   GET  /api/session/:code    -> does this session exist?
//   GET  /api/ws/:code         -> WebSocket upgrade, proxied to that session's Durable Object
//   everything else            -> static assets from ./public

export { GameSession } from './session.js';
export { SessionRegistry } from './registry.js';

// Ambiguous glyphs (0/O, 1/I/L) are omitted so codes can be read aloud reliably.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

function generateCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function sessionStub(env, code) {
    return env.SESSIONS.get(env.SESSIONS.idFromName(code));
}

// The assets binding answers /game.html with a 307 to /game (it strips .html).
// Passing that redirect through would bounce the browser off /play/CODE and lose the
// session code, so resolve it here and answer 200 at the URL the player is on.
async function serveAppShell(request, env) {
    const shell = new URL(request.url);
    shell.pathname = '/game.html';

    let res = await env.ASSETS.fetch(new Request(shell, { method: 'GET' }));
    for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
        const location = res.headers.get('location');
        if (!location) break;
        res = await env.ASSETS.fetch(new Request(new URL(location, shell), { method: 'GET' }));
    }

    return new Response(res.body, {
        status: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache'
        }
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (path === '/api/session' && request.method === 'POST') {
            let body = {};
            try { body = await request.json(); } catch { /* defaults are fine */ }

            // Collisions are astronomically unlikely, but a taken code would silently
            // drop a player into someone else's game, so verify before handing it out.
            let code = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                const candidate = generateCode();
                const probe = await sessionStub(env, candidate).fetch(
                    new Request('https://session/exists'));
                const { exists } = await probe.json();
                if (!exists) { code = candidate; break; }
            }
            if (!code) return json({ error: 'Could not allocate a session code. Try again.' }, 503);

            const res = await sessionStub(env, code).fetch(new Request('https://session/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, mode: body.mode, config: body.config })
            }));
            if (!res.ok) return res;
            return json({ code });
        }

        if (path === '/api/stats' && request.method === 'GET') {
            const registry = env.REGISTRY.get(env.REGISTRY.idFromName('global'));
            const res = await registry.fetch(new Request('https://registry/stats'));
            const stats = await res.json();
            return new Response(JSON.stringify(stats), {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
            });
        }

        const existsMatch = path.match(/^\/api\/session\/([A-Za-z0-9]+)$/);
        if (existsMatch && request.method === 'GET') {
            const code = existsMatch[1].toUpperCase();
            const probe = await sessionStub(env, code).fetch(new Request('https://session/exists'));
            const data = await probe.json();
            return json({ code, exists: !!data.exists, playerCount: data.playerCount || 0 });
        }

        const wsMatch = path.match(/^\/api\/ws\/([A-Za-z0-9]+)$/);
        if (wsMatch) {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('Expected a WebSocket upgrade', { status: 426 });
            }
            const code = wsMatch[1].toUpperCase();
            const target = new URL(request.url);
            target.pathname = '/connect';
            return sessionStub(env, code).fetch(new Request(target, request));
        }

        if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

        // Deep links like /play/ABCDE are resolved client-side from the URL, so the
        // browser must stay on that URL.
        if (path.startsWith('/play')) return serveAppShell(request, env);

        return env.ASSETS.fetch(request);
    }
};
