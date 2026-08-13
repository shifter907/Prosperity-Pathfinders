// One Durable Object instance per game session, addressed by its join code.
//
// This object is the sole authority on game state. Clients send intents; every
// mutation is validated and applied here, so a tampered client cannot edit another
// player's ledger or advance the turn on its own.

import {
    DEFAULT_CONFIG, normalizeConfig, num,
    CAREERS, HOBBIES, COMMERCIAL_BASELINES,
    createPlayer, applyCardToPlayer, pickRandomCard,
    calculateMonthlyPI, getMortgageTurnDetails, resyncPrimaryMortgage, refreshOwnedHousingCost,
    investmentPropertyQuote, recomputeInvestmentTotals,
    loanPaymentPerTurn, advanceLoanOneTurn, describeLoan, recomputeLoanTotals,
    calculatePlayerNetWorth
} from '../public/shared/engine.js';
import { SESSION_TTL_MS } from './registry.js';

const MAX_PLAYERS = 8;
const MAX_LOG = 200;

export class GameSession {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.state = null;
        // Set while the expiry alarm is tearing the session down. Closing the sockets
        // fires webSocketClose -> markPresence -> save(), which would rewrite state and
        // re-arm the alarm, resurrecting the session we are in the middle of deleting.
        this.expiring = false;
    }

    async load() {
        if (!this.state) this.state = await this.ctx.storage.get('state');
        return this.state;
    }

    // Overridable so the expiry path can be exercised for real in local testing
    // (`wrangler dev --var SESSION_TTL_MS:5000`) instead of waiting seven days.
    ttl() {
        const override = Number(this.env.SESSION_TTL_MS);
        return Number.isFinite(override) && override > 0 ? override : SESSION_TTL_MS;
    }

    async save() {
        if (this.expiring || !this.state) return;
        this.state.expiresAt = Date.now() + this.ttl();
        await this.ctx.storage.put('state', this.state);
        // Setting an alarm replaces any existing one, so the deadline is always
        // measured from the most recent change to the session.
        await this.ctx.storage.setAlarm(this.state.expiresAt);
    }

    // Fires SESSION_TTL_MS after the last change. Nothing has touched this session
    // for a week, so remove it entirely.
    async alarm() {
        const state = await this.load();
        const code = state ? state.code : null;
        this.expiring = true;

        const days = Math.max(1, Math.round(this.ttl() / 86400000));
        this.broadcast({
            type: 'expired',
            message: `This session expired after ${days} day${days === 1 ? '' : 's'} of inactivity.`
        });
        for (const ws of this.ctx.getWebSockets()) {
            try { ws.close(1000, 'session expired'); } catch { /* already gone */ }
        }

        if (code) await this.reportToRegistry({ code, deleted: true });

        // deleteAll() only clears the alarm on compatibility dates from 2026-02-24;
        // deleting it explicitly keeps this correct on any date.
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.state = null;
    }

    // Best-effort: the lobby board is cosmetic, so a registry hiccup must never
    // break gameplay.
    async reportToRegistry(payload) {
        try {
            const stub = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('global'));
            await stub.fetch(new Request('https://registry/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }));
        } catch { /* ignore */ }
    }

    async reportPresence(excludeWs = null) {
        const state = this.state;
        if (!state) return;
        await this.reportToRegistry({
            code: state.code,
            players: state.players.length,
            connected: this.connectedPlayerIds(excludeWs).size,
            turn: state.turn
        });
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/exists') {
            const state = await this.load();
            return Response.json({
                exists: !!state,
                playerCount: state ? state.players.length : 0
            });
        }

        if (url.pathname === '/create') {
            const body = await request.json();
            const existing = await this.load();
            if (existing) return Response.json({ error: 'Session already exists' }, { status: 409 });

            this.state = {
                code: body.code,
                createdAt: Date.now(),
                // 'host'  - the creator plays and keeps live controls
                // 'equal' - everyone is a peer; settings are fixed at creation
                mode: body.mode === 'equal' ? 'equal' : 'host',
                hostId: null,
                turn: 1,
                lastCard: null,
                config: normalizeConfig(body.config),
                resiMultiplier: 1,
                commMultiplier: 1,
                players: [],
                log: [{ t: Date.now(), msg: 'Session created. Share the code to invite players.' }]
            };
            await this.save();
            return Response.json({ ok: true });
        }

        if (url.pathname === '/connect') {
            const state = await this.load();
            if (!state) return new Response('No such session', { status: 404 });

            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            this.ctx.acceptWebSocket(server);
            // Identity is established by the first `hello` message, not the socket itself.
            server.serializeAttachment({ playerId: null });
            return new Response(null, { status: 101, webSocket: client });
        }

        return new Response('Not found', { status: 404 });
    }

    // --- websocket plumbing -------------------------------------------------

    async webSocketMessage(ws, raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return this.send(ws, { type: 'error', message: 'Malformed message' }); }

        const state = await this.load();
        if (!state) return this.send(ws, { type: 'error', message: 'Session no longer exists' });

        try {
            await this.handle(ws, msg, state);
        } catch (err) {
            this.send(ws, { type: 'error', message: err.message || 'Something went wrong' });
        }
    }

    // The closing socket is still listed by getWebSockets() while these handlers run,
    // so it must be excluded or the player looks permanently online.
    async webSocketClose(ws) {
        await this.markPresence(ws);
    }

    async webSocketError(ws) {
        await this.markPresence(ws);
    }

    send(ws, payload) {
        try { ws.send(JSON.stringify(payload)); } catch { /* socket already gone */ }
    }

    broadcast(payload) {
        const data = JSON.stringify(payload);
        for (const ws of this.ctx.getWebSockets()) {
            try { ws.send(data); } catch { /* socket already gone */ }
        }
    }

    attachmentOf(ws) {
        try { return ws.deserializeAttachment() || {}; } catch { return {}; }
    }

    connectedPlayerIds(excludeWs = null) {
        const ids = new Set();
        for (const ws of this.ctx.getWebSockets()) {
            if (excludeWs && ws === excludeWs) continue;
            const { playerId } = this.attachmentOf(ws);
            if (playerId) ids.add(playerId);
        }
        return ids;
    }

    // Presence is derived from live sockets rather than stored, so a hard refresh or
    // a dropped connection can never leave a player wrongly marked online.
    async markPresence(excludeWs = null) {
        const state = await this.load();
        if (!state) return;
        const online = this.connectedPlayerIds(excludeWs);
        let changed = false;
        for (const p of state.players) {
            const isOnline = online.has(p.id);
            if (p.connected !== isOnline) { p.connected = isOnline; changed = true; }
        }
        if (changed) await this.save();
        await this.reportPresence(excludeWs);
        this.broadcastState();
    }

    // Secrets never leave the server; each client learns only its own via `you`.
    publicState() {
        const s = this.state;
        return {
            code: s.code,
            mode: s.mode,
            hostId: s.hostId,
            expiresAt: s.expiresAt || null,
            turn: s.turn,
            lastCard: s.lastCard,
            config: s.config,
            resiMultiplier: s.resiMultiplier,
            commMultiplier: s.commMultiplier,
            log: s.log.slice(-MAX_LOG),
            players: s.players.map(({ secret, ...rest }) => rest)
        };
    }

    broadcastState() {
        if (!this.state) return;
        this.broadcast({ type: 'state', state: this.publicState() });
    }

    log(msg) {
        this.state.log.push({ t: Date.now(), msg });
        if (this.state.log.length > MAX_LOG) this.state.log = this.state.log.slice(-MAX_LOG);
    }

    // --- message dispatch ---------------------------------------------------

    async handle(ws, msg, state) {
        if (msg.type === 'hello') {
            // Reconnect with an existing secret, or observe until `join`.
            const player = msg.secret ? state.players.find(p => p.secret === msg.secret) : null;
            if (player) {
                ws.serializeAttachment({ playerId: player.id });
                player.connected = true;
                await this.save();
                this.send(ws, { type: 'you', playerId: player.id, secret: player.secret });
            } else {
                this.send(ws, { type: 'you', playerId: null, secret: null });
            }
            await this.markPresence();
            this.send(ws, { type: 'state', state: this.publicState() });
            return;
        }

        if (msg.type === 'join') {
            const name = String(msg.name || '').trim().slice(0, 24);
            if (!name) throw new Error('Please enter a character name.');
            if (state.players.length >= MAX_PLAYERS) throw new Error(`This session is full (${MAX_PLAYERS} players).`);
            if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                throw new Error('That name is already taken in this session.');
            }

            const id = crypto.randomUUID();
            const secret = crypto.randomUUID();
            const player = createPlayer({ id, name, career: msg.career, hobby: msg.hobby }, state.config);
            player.secret = secret;
            player.connected = true;
            player.ready = false;
            state.players.push(player);

            // First player through the door owns the session in host mode.
            if (!state.hostId) state.hostId = id;

            ws.serializeAttachment({ playerId: id });
            this.log(`${name} joined as ${(CAREERS[player.career] || {}).name}.`);
            await this.save();
            await this.reportPresence();

            this.send(ws, { type: 'you', playerId: id, secret });
            this.broadcastState();
            return;
        }

        // Everything below requires an identified player.
        const { playerId } = this.attachmentOf(ws);
        const me = state.players.find(p => p.id === playerId);
        if (!me) throw new Error('Join the session before taking actions.');

        switch (msg.type) {
            case 'ready': {
                me.ready = !!msg.ready;
                await this.save();
                this.broadcastState();
                await this.maybeAdvanceTurn();
                return;
            }

            case 'action': {
                // The heart of the "own ledger only" rule: actions are applied to the
                // caller's own player record, never to an id supplied by the client.
                const summary = this.applyAction(me, msg.action || {}, state);
                if (summary) this.log(summary);
                await this.save();
                this.broadcastState();
                return;
            }

            case 'settings': {
                this.requireHostControls(state, me);
                state.config = normalizeConfig(msg.config);
                this.log(`${me.name} updated the session's economic settings.`);
                await this.save();
                this.broadcastState();
                return;
            }

            case 'forceAdvance': {
                this.requireHostControls(state, me);
                this.log(`${me.name} forced the turn to reconcile.`);
                await this.advanceTurn();
                return;
            }

            case 'removePlayer': {
                this.requireHostControls(state, me);
                const target = state.players.find(p => p.id === msg.playerId);
                if (!target) throw new Error('That player is not in this session.');
                if (target.id === state.hostId) throw new Error('The host cannot be removed.');
                state.players = state.players.filter(p => p.id !== target.id);
                this.log(`${target.name} was removed from the session.`);
                await this.save();
                this.broadcastState();
                await this.maybeAdvanceTurn();
                return;
            }

            default:
                throw new Error(`Unknown message type: ${msg.type}`);
        }
    }

    requireHostControls(state, me) {
        if (state.mode !== 'host') {
            throw new Error('This session was created in equal-players mode; no one holds live controls.');
        }
        if (state.hostId !== me.id) throw new Error('Only the session host can do that.');
    }

    // --- turn progression ---------------------------------------------------

    async maybeAdvanceTurn() {
        const state = this.state;
        const online = this.connectedPlayerIds();
        // Only players actually connected can gate the turn; otherwise one dropped
        // connection would deadlock a session that has no host override.
        const gating = state.players.filter(p => online.has(p.id));
        if (gating.length === 0) return;
        if (!gating.every(p => p.ready)) return;
        await this.advanceTurn();
    }

    async advanceTurn() {
        const state = this.state;
        if (state.players.length === 0) return;

        const card = pickRandomCard();

        state.resiMultiplier *= (1 + card.resi / 100);
        state.commMultiplier *= (1 + card.comm / 100);

        const lines = [];
        for (const p of state.players) {
            lines.push(...applyCardToPlayer(p, card, state.config));
            p.ready = false;
        }

        state.turn += 1;
        state.lastCard = card;

        this.log(`--- Turn ${state.turn - 1} reconciled with market card ${card.label} ---`);
        for (const line of lines) this.log(line);

        await this.save();
        await this.reportPresence();
        this.broadcast({ type: 'turn', card, turn: state.turn });
        this.broadcastState();
    }

    // --- ledger actions -----------------------------------------------------

    applyAction(p, action, state) {
        const cfg = state.config;
        const kind = action.kind;
        const amount = Math.round(num(action.amount));

        switch (kind) {
            case 'buyAsset': {
                const cat = action.category;
                if (!['vti', 'iyw', 'ixc', 'bonds', 'crypto'].includes(cat)) throw new Error('Unknown asset category.');
                if (amount <= 0) throw new Error('Enter a positive amount.');
                p.cash = Math.round(num(p.cash) - amount);
                p[cat] = Math.round(num(p[cat]) + amount);
                return `${p.name} invested $${amount.toLocaleString()} in ${cat.toUpperCase()}.`;
            }

            case 'sellAsset': {
                const cat = action.category;
                if (!['vti', 'iyw', 'ixc', 'bonds', 'crypto', 'resi', 'comm'].includes(cat)) throw new Error('Unknown asset category.');
                if (amount <= 0) throw new Error('Enter a positive amount.');
                // Only credit what was actually sold, so clamping cannot mint cash.
                const sold = Math.min(amount, Math.max(0, num(p[cat])));
                if (sold <= 0) throw new Error('There is nothing to liquidate in that category.');
                p[cat] = Math.round(num(p[cat]) - sold);
                p.cash = Math.round(num(p.cash) + sold);
                return `${p.name} sold $${sold.toLocaleString()} of ${cat.toUpperCase()}.`;
            }

            case 'payDebt': {
                if (amount <= 0) throw new Error('Enter a positive amount.');
                const primary = num(p.mortgages);
                const other = num(p.otherDebts);
                const total = primary + other + num(p.loanDebt);
                if (total <= 0) throw new Error('You have no outstanding debt.');

                // Charge only what actually retires debt; overpayment is not consumed.
                const applied = Math.min(amount, total);
                const toPrimary = Math.min(primary, applied);
                const toOther = Math.min(other, applied - toPrimary);
                let remaining = applied - toPrimary - toOther;
                p.mortgages = Math.round(primary - toPrimary);
                p.otherDebts = Math.round(other - toOther);
                for (const loan of (p.loans || [])) {
                    if (remaining <= 0) break;
                    const hit = Math.min(num(loan.balance), remaining);
                    loan.balance = Math.round(num(loan.balance) - hit);
                    remaining -= hit;
                }
                p.loans = (p.loans || []).filter(l => num(l.balance) > 0);
                recomputeLoanTotals(p);
                p.cash = Math.round(num(p.cash) - applied);
                if (p.mortgages <= 0 && p.housingStatus === 'owning') {
                    p.mortgagePI = 0;
                    refreshOwnedHousingCost(p, cfg);
                }
                return `${p.name} paid down $${applied.toLocaleString()} of debt.`;
            }

            case 'borrow': {
                if (amount <= 0) throw new Error('Enter a positive amount.');
                const annualRate = num(action.annualRate) / 100;
                if (annualRate < 0) throw new Error('Interest rate cannot be negative.');
                const type = action.loanType === 'interest' ? 'interest' : 'amortized';
                const mode = action.mode === 'manual' ? 'manual' : 'auto';
                const termMonths = Math.max(1, Math.round(num(action.termMonths, 60)));

                const loan = {
                    id: crypto.randomUUID(),
                    principal: amount,
                    balance: amount,
                    annualRate,
                    type,
                    mode,
                    termMonths: type === 'amortized' ? termMonths : 0,
                    monthlyPayment: type === 'amortized' ? calculateMonthlyPI(amount, annualRate, termMonths) : 0
                };
                if (!p.loans) p.loans = [];
                p.loans.push(loan);
                p.cash = Math.round(num(p.cash) + amount);
                recomputeLoanTotals(p);
                return `${p.name} borrowed $${amount.toLocaleString()} at ${describeLoan(loan)} (${mode} payments).`;
            }

            case 'payLoanTurn': {
                const loan = (p.loans || [])[action.index];
                if (!loan) throw new Error('That loan no longer exists.');
                const due = loanPaymentPerTurn(loan);
                if (due <= 0) throw new Error('Nothing is due on that loan.');
                if (num(p.cash) < due) throw new Error('Insufficient cash for that loan payment.');
                const paid = advanceLoanOneTurn(loan, true);
                p.cash = Math.round(num(p.cash) - paid);
                const cleared = num(loan.balance) <= 0;
                if (cleared) p.loans.splice(action.index, 1);
                recomputeLoanTotals(p);
                return cleared
                    ? `${p.name} cleared a ${describeLoan(loan)} loan.`
                    : `${p.name} paid $${paid.toLocaleString()} on a ${describeLoan(loan)} loan.`;
            }

            case 'payoffLoan': {
                const loan = (p.loans || [])[action.index];
                if (!loan) throw new Error('That loan no longer exists.');
                const balance = Math.round(num(loan.balance));
                if (num(p.cash) < balance) throw new Error('Insufficient cash to pay off that loan.');
                p.cash = Math.round(num(p.cash) - balance);
                p.loans.splice(action.index, 1);
                recomputeLoanTotals(p);
                return `${p.name} paid off a ${describeLoan(loan)} loan in full ($${balance.toLocaleString()}).`;
            }

            case 'toggleLoanMode': {
                const loan = (p.loans || [])[action.index];
                if (!loan) throw new Error('That loan no longer exists.');
                loan.mode = loan.mode === 'auto' ? 'manual' : 'auto';
                recomputeLoanTotals(p);
                return `${p.name} switched a loan to ${loan.mode} payments.`;
            }

            case 'buyHome': {
                const price = Math.round(num(action.price));
                const down = Math.round(num(action.downPayment));
                if (price <= 0 || down <= 0) throw new Error('Enter a valid price and down payment.');
                if (down > price) throw new Error('Down payment cannot exceed the price.');
                if (num(p.mortgages) > 0) throw new Error('Pay off your current mortgage first.');

                const loanAmount = price - down;
                const annualRate = num(cfg.interestRate) / 100;
                const monthlyPI = calculateMonthlyPI(loanAmount, annualRate, 360);

                p.cash = Math.round(num(p.cash) - down);
                // Tracked apart from the resi INVESTMENT bucket so liquidating
                // investments can never sell the player's own home.
                p.homeValue = price;
                p.homePurchasePrice = price;
                p.mortgages = Math.round(loanAmount);
                p.housingStatus = 'owning';
                p.mortgageRate = annualRate;
                p.mortgagePI = monthlyPI;
                p.housing = getMortgageTurnDetails(loanAmount, annualRate, monthlyPI, num(cfg.taxInsRate) / 100, price).piti6Mo;
                return `${p.name} bought a home for $${price.toLocaleString()} ($${down.toLocaleString()} down).`;
            }

            case 'payExtraPrincipal': {
                if (amount <= 0) throw new Error('Enter a positive amount.');
                const actual = Math.min(num(p.mortgages), amount);
                if (actual <= 0) throw new Error('There is no mortgage balance to pay down.');
                if (num(p.cash) < actual) throw new Error('Insufficient cash for that payment.');
                p.cash = Math.round(num(p.cash) - actual);
                p.mortgages = Math.round(num(p.mortgages) - actual);
                if (p.mortgages <= 0) { p.mortgages = 0; p.mortgagePI = 0; }
                refreshOwnedHousingCost(p, cfg);
                return `${p.name} paid $${actual.toLocaleString()} extra toward principal.`;
            }

            case 'payoffMortgage': {
                const balance = Math.round(num(p.mortgages));
                if (balance <= 0) throw new Error('Your residence is already owned free and clear.');
                if (num(p.cash) < balance) throw new Error('Insufficient cash to pay off the mortgage.');
                p.cash = Math.round(num(p.cash) - balance);
                p.mortgages = 0;
                p.mortgagePI = 0;
                refreshOwnedHousingCost(p, cfg);
                return `${p.name} paid off their mortgage in full ($${balance.toLocaleString()}).`;
            }

            case 'buyProperty': {
                const category = action.category === 'comm' ? 'comm' : 'resi';
                const selection = String(action.selection || '1');
                const price = Math.round(num(action.price));
                const down = Math.round(num(action.downpayment));
                if (price <= 0 || down <= 0) throw new Error('Enter a valid price and down payment.');
                if (down > price) throw new Error('Down payment cannot exceed the price.');

                const q = investmentPropertyQuote(category, selection, price, down, cfg);
                p.cash = Math.round(num(p.cash) - down);
                p[category] = Math.round(num(p[category]) + price);
                if (!p.properties) p.properties = [];
                p.properties.push({
                    type: category === 'resi' ? 'residential' : 'commercial',
                    subType: selection,
                    units: category === 'resi' ? num(selection, 1) : 1,
                    purchasePrice: price,
                    downPayment: down,
                    loanAmount: q.loanAmount,
                    loanBalance: q.loanAmount,
                    annualRate: q.annualRate,
                    taxInsRate: q.taxInsRate,
                    amortizedPayment: q.amortizedPayment,
                    taxesIns: q.taxesIns,
                    currentGrossRent: q.gross6MoRent,
                    netCashFlow: q.netCashFlow
                });
                recomputeInvestmentTotals(p);
                const label = category === 'resi'
                    ? `${selection}-unit residential`
                    : ((COMMERCIAL_BASELINES[selection] || {}).name || 'commercial');
                return `${p.name} bought a ${label} property for $${price.toLocaleString()}.`;
            }

            case 'sellProperty': {
                const prop = (p.properties || [])[action.index];
                if (!prop) throw new Error('That property no longer exists.');
                const bucket = prop.type === 'commercial' ? 'comm' : 'resi';
                const salePrice = Math.round(num(prop.purchasePrice));
                const payoff = Math.round(num(prop.loanBalance));
                p[bucket] = Math.max(0, Math.round(num(p[bucket]) - salePrice));
                p.cash = Math.round(num(p.cash) + (salePrice - payoff));
                p.properties.splice(action.index, 1);
                recomputeInvestmentTotals(p);
                return `${p.name} liquidated a property for $${salePrice.toLocaleString()} (cleared $${payoff.toLocaleString()} of debt).`;
            }

            case 'setHousing': {
                const status = action.status === 'owning' ? 'owning' : 'renting';
                p.housingStatus = status;
                if (status === 'renting') {
                    p.monthlyRent = Math.max(0, Math.round(num(action.monthlyRent, cfg.rentBaseline)));
                    p.housing = p.monthlyRent * 6;
                    p.mortgagePI = 0;
                } else {
                    resyncPrimaryMortgage(p, cfg);
                    refreshOwnedHousingCost(p, cfg);
                }
                return `${p.name} set housing to ${status}.`;
            }

            case 'updateLedger': {
                // Direct ledger editing, restricted to a known field list. Every value
                // goes through num() so a blank or junk input cannot NaN the ledger.
                const f = action.fields || {};
                const moneyFields = ['cash', 'vti', 'iyw', 'ixc', 'bonds', 'resi', 'comm', 'crypto',
                    'homeValue', 'mortgages', 'otherDebts', 'salary', 'rentalNet', 'dividends'];
                for (const key of moneyFields) {
                    if (f[key] !== undefined) p[key] = Math.round(num(f[key]));
                }
                // These three arrive as MONTHLY figures; the ledger stores 6-month totals.
                if (f.housingMonthly !== undefined) p.housing = Math.round(num(f.housingMonthly) * 6);
                if (f.fixedFoodMonthly !== undefined) p.fixedFood = Math.round(num(f.fixedFoodMonthly) * 6);
                if (f.transportation !== undefined) p.transportation = Math.round(num(f.transportation));
                if (p.housingStatus === 'renting') p.monthlyRent = Math.round(num(p.housing) / 6);
                if (p.housingStatus === 'owning') resyncPrimaryMortgage(p, cfg);
                recomputeLoanTotals(p);
                recomputeInvestmentTotals(p);
                return `${p.name} adjusted their ledger directly.`;
            }

            default:
                throw new Error(`Unknown action: ${kind}`);
        }
    }
}
