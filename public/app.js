// Client for a game session. The server owns all state; this file renders it and
// sends intents. Engine imports are only used for local previews (loan payment,
// property quote) so the numbers shown before you commit match what the server does.

import {
    CAREERS, HOBBIES, UNIT_BASELINES, COMMERCIAL_BASELINES,
    num, normalizeConfig, calculateMonthlyPI, calculateTurnCashFlow,
    calculatePlayerNetWorth, calculatePlayerDebt, playerMetrics,
    investmentPropertyQuote, baselinePropertyPrice,
    loanPaymentPerTurn, describeLoan, getMortgageTurnDetails
} from '/shared/engine.js';

// Accept /play/CODE, and ?code=CODE as a fallback so deep links keep working if the
// app is ever served under a different path prefix.
const CODE = (new URLSearchParams(location.search).get('code')
    || location.pathname.split('/').filter(Boolean)[1]
    || '').toUpperCase();
const SECRET_KEY = `pp_secret_${CODE}`;

let ws = null;
let state = null;
let myId = null;
let mySecret = localStorage.getItem(SECRET_KEY) || null;
let txType = 'buy';
let reconnectDelay = 1000;
let expired = false;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(v) {
    const n = Math.round(num(v));
    return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;
}

function toast(msg, kind = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'fixed bottom-5 right-5 z-50 transition-all duration-300 pointer-events-none px-4 py-3 rounded-lg shadow-xl text-xs font-bold ' +
        (kind === 'err' ? 'bg-rose-600 text-white' : 'bg-emerald-500 text-zinc-950');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.classList.add('translate-y-24', 'opacity-0'); }, 3200);
    t.classList.remove('translate-y-24', 'opacity-0');
}

const me = () => state && myId ? state.players.find(p => p.id === myId) : null;
const iAmHost = () => state && state.mode === 'host' && state.hostId === myId;

// --- connection -------------------------------------------------------------

function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/api/ws/${CODE}`);

    ws.addEventListener('open', () => {
        reconnectDelay = 1000;
        setConn('live', 'bg-emerald-500');
        send({ type: 'hello', secret: mySecret });
    });

    ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'you') {
            myId = msg.playerId;
            if (msg.secret) { mySecret = msg.secret; localStorage.setItem(SECRET_KEY, msg.secret); }
        } else if (msg.type === 'state') {
            state = msg.state;
            render();
        } else if (msg.type === 'turn') {
            toast(`Turn reconciled — market card ${msg.card.label}`);
        } else if (msg.type === 'expired') {
            // The session deleted itself; stop reconnecting and send the player home.
            expired = true;
            localStorage.removeItem(SECRET_KEY);
            alert(msg.message);
            location.href = '/';
        } else if (msg.type === 'error') {
            toast(msg.message, 'err');
            $('gate-error').textContent = msg.message;
            $('gate-error').classList.remove('hide');
            $('gate-join').disabled = false;
        }
    });

    ws.addEventListener('close', () => {
        if (expired) return;
        setConn('offline', 'bg-rose-500');
        // Exponential backoff keeps a dead session from hammering the Worker.
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    });

    ws.addEventListener('error', () => ws.close());
}

function setConn(text, dotClass) {
    $('conn-status').innerHTML = `<span class="dot ${dotClass}"></span><span>${text}</span>`;
}

function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

const act = (action) => send({ type: 'action', action });

// --- render -----------------------------------------------------------------

function render() {
    if (!state) return;

    $('gate-code').textContent = state.code;
    $('code-chip').textContent = state.code;
    $('turn-chip').textContent = `Turn ${state.turn}`;

    const modeChip = $('mode-chip');
    modeChip.textContent = state.mode === 'host' ? 'Host controls' : 'Equal players';
    modeChip.className = 'text-[10px] uppercase font-bold px-2 py-1 rounded border hidden sm:inline ' +
        (state.mode === 'host'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-400');

    const chip = $('expiry-chip');
    if (state.expiresAt) {
        const days = (state.expiresAt - Date.now()) / 86400000;
        chip.textContent = days > 1
            ? `expires in ${Math.round(days)} days`
            : `expires in ${Math.max(1, Math.round(days * 24))}h`;
    } else {
        chip.textContent = '';
    }

    const joined = !!me();
    $('join-gate').classList.toggle('hide', joined);

    renderCard();
    renderRoster();
    renderLog();

    if (joined) {
        renderMe();
        renderLoans();
        renderProps();
        renderHousing();
        renderLedgerFields();
    }

    const hostOnly = iAmHost();
    $('host-settings-btn').classList.toggle('hide', !hostOnly);
    $('force-advance-btn').classList.toggle('hide', !hostOnly);
}

function renderCard() {
    const card = state.lastCard;
    const label = $('card-label');
    const body = $('card-body');

    if (!card) {
        label.textContent = '—';
        body.innerHTML = `<p class="text-[11px] text-zinc-500 italic py-3 text-center">
            No market card has been applied yet. The first card is drawn when everyone marks themselves done.</p>`;
        return;
    }

    label.textContent = card.label;
    const rows = [
        ['VTI (Stock Market)', card.vti], ['IYW (Tech ETF)', card.iyw],
        ['IXC (Energy ETF)', card.ixc], ['Bonds', card.bonds],
        ['Residential RE', card.resi], ['Commercial RE', card.comm],
        ['Market Rent Index', card.rent], ['Total Crypto Market', card.crypto]
    ];
    body.innerHTML = rows.map(([name, rate]) => {
        const cls = rate > 0 ? 'text-emerald-400' : rate < 0 ? 'text-rose-400' : 'text-zinc-500';
        return `<div class="flex justify-between items-center text-[11px] border-b border-zinc-900 pb-1">
            <span class="text-zinc-300">${name}</span>
            <span class="${cls} font-bold code-font">${rate > 0 ? '+' : ''}${rate}%</span>
        </div>`;
    }).join('');
}

function renderRoster() {
    const online = state.players.filter(p => p.connected);
    const readyOnline = online.filter(p => p.ready);
    $('ready-count').textContent = `${readyOnline.length}/${online.length} ready`;

    $('roster').innerHTML = state.players.map(p => {
        const isMe = p.id === myId;
        const career = (CAREERS[p.career] || {}).name || 'Unknown';
        return `<div class="flex items-center justify-between gap-2 p-2.5 rounded-lg border ${
            isMe ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-zinc-950 border-zinc-800'}">
            <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                    <span class="dot ${p.connected ? 'bg-emerald-500' : 'bg-zinc-600'}"></span>
                    <span class="text-xs font-bold truncate">${esc(p.name)}</span>
                    ${p.id === state.hostId ? '<span class="text-[9px] text-amber-400 font-bold">HOST</span>' : ''}
                    ${isMe ? '<span class="text-[9px] text-emerald-400 font-bold">YOU</span>' : ''}
                </div>
                <div class="text-[10px] text-zinc-500 truncate">${esc(career)} · NW ${money(calculatePlayerNetWorth(p))}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="text-[10px] font-bold ${p.ready ? 'text-emerald-400' : 'text-zinc-600'}">
                    ${p.ready ? '✓ done' : 'thinking'}
                </span>
                ${iAmHost() && !isMe ? `<button data-remove="${p.id}" class="text-[9px] text-zinc-600 hover:text-rose-400">remove</button>` : ''}
            </div>
        </div>`;
    }).join('');

    $('roster').querySelectorAll('[data-remove]').forEach(b => {
        b.onclick = () => {
            if (confirm('Remove this player from the session?')) {
                send({ type: 'removePlayer', playerId: b.dataset.remove });
            }
        };
    });

    const waiting = online.filter(p => !p.ready).map(p => p.name);
    $('waiting-on').textContent = waiting.length
        ? `Waiting on ${waiting.join(', ')}. Disconnected players don't hold up the turn.`
        : (online.length ? 'Everyone is ready — reconciling…' : 'No one is connected.');
}

function renderLog() {
    const el = $('log');
    el.innerHTML = state.log.map(l =>
        `<div class="text-zinc-400">${esc(l.msg)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
}

function renderMe() {
    const p = me();
    $('me-name').textContent = p.name;
    const career = (CAREERS[p.career] || {}).name || '';
    const hobby = (HOBBIES[p.hobby] || {}).name || '';
    const flow = calculateTurnCashFlow(p, state.config);
    $('me-sub').innerHTML = `${esc(career)} · ${esc(hobby)} · Age ${num(p.age, 22)} · ` +
        `projected next turn <span class="${flow >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-bold">${flow >= 0 ? '+' : ''}${money(flow)}</span>`;

    const btn = $('ready-btn');
    btn.textContent = p.ready ? '✓ Done — click to undo' : 'Mark me done';
    btn.className = 'px-5 py-2.5 rounded-lg font-bold text-xs transition-all shrink-0 ' +
        (p.ready ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400'
                 : 'bg-emerald-600 hover:bg-emerald-500 text-zinc-950');

    const now = playerMetrics(p);
    const prev = p.prevMetrics;
    const rows = [
        ['cash', 'Liquid Cash', num(p.cash) < 0 ? 'text-rose-400' : 'text-emerald-400', false],
        ['netWorth', 'Net Worth', 'text-indigo-400', false],
        ['stocks', 'Stocks & ETFs', 'text-zinc-200', false],
        ['bonds', 'Bonds', 'text-zinc-200', false],
        ['crypto', 'Crypto', 'text-zinc-200', false],
        ['realEstate', 'Real Estate', 'text-zinc-200', false],
        ['rentalNet', 'Rental Net/Turn', 'text-zinc-200', false],
        ['totalDebt', 'Total Debt', 'text-rose-400', true]
    ];

    $('me-metrics').innerHTML = `
        <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 pb-1 mb-0.5 border-b border-zinc-800">
            <span class="text-[9px] uppercase tracking-wider text-zinc-600 font-bold">Metric</span>
            <span class="text-[9px] uppercase tracking-wider text-zinc-600 font-bold text-right">Value</span>
            <span class="text-[9px] uppercase tracking-wider text-zinc-600 font-bold text-right min-w-[80px]">Last Turn</span>
        </div>` + rows.map(([key, label, tone, riseIsBad]) => {
        let delta = `<span class="text-zinc-700">&mdash;</span>`;
        if (prev && Number.isFinite(prev[key])) {
            const d = now[key] - prev[key];
            if (d === 0) delta = `<span class="text-zinc-600">&plusmn;$0</span>`;
            else {
                const good = riseIsBad ? d < 0 : d > 0;
                delta = `<span class="${good ? 'text-emerald-400' : 'text-rose-400'}">${d > 0 ? '+' : '-'}$${Math.abs(d).toLocaleString()}</span>`;
            }
        }
        return `<div class="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 py-1 border-b border-zinc-900/40">
            <span class="text-[11px] text-zinc-500 font-medium">${label}</span>
            <span class="code-font text-xs font-bold ${tone} text-right">${money(now[key])}</span>
            <span class="code-font text-[10px] text-right min-w-[80px]">${delta}</span>
        </div>`;
    }).join('');
}

function renderLoans() {
    const p = me();
    const loans = p.loans || [];
    $('loans-list').innerHTML = loans.length === 0
        ? `<p class="text-[10px] text-zinc-600 italic">No outstanding loans.</p>`
        : `<div class="text-[10px] uppercase font-bold text-zinc-400 mb-1">Your loans</div>` +
          loans.map((l, i) => `
            <div class="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
              <div class="min-w-0">
                <div class="text-xs font-bold code-font text-rose-400">${money(l.balance)}</div>
                <div class="text-[10px] text-zinc-500 truncate">${esc(describeLoan(l))} · ${money(loanPaymentPerTurn(l))}/turn ·
                  <span class="${l.mode === 'auto' ? 'text-emerald-400' : 'text-amber-400'}">${l.mode}</span></div>
              </div>
              <div class="flex gap-1 shrink-0">
                <button data-loan-mode="${i}" class="text-[9px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 rounded">${l.mode === 'auto' ? 'Manual' : 'Auto'}</button>
                <button data-loan-pay="${i}" class="text-[9px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 rounded">Pay turn</button>
                <button data-loan-off="${i}" class="text-[9px] bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-400 px-2 py-1 rounded">Payoff</button>
              </div>
            </div>`).join('');

    $('loans-list').querySelectorAll('[data-loan-mode]').forEach(b =>
        b.onclick = () => act({ kind: 'toggleLoanMode', index: +b.dataset.loanMode }));
    $('loans-list').querySelectorAll('[data-loan-pay]').forEach(b =>
        b.onclick = () => act({ kind: 'payLoanTurn', index: +b.dataset.loanPay }));
    $('loans-list').querySelectorAll('[data-loan-off]').forEach(b =>
        b.onclick = () => { if (confirm('Pay off this loan in full?')) act({ kind: 'payoffLoan', index: +b.dataset.loanOff }); });
}

function renderProps() {
    const p = me();
    const props = p.properties || [];
    $('props-list').innerHTML = props.length === 0
        ? `<p class="text-[10px] text-zinc-600 italic">No investment properties.</p>`
        : `<div class="text-[10px] uppercase font-bold text-zinc-400 mb-1">Your properties</div>` +
          props.map((pr, i) => {
            const label = pr.type === 'residential'
                ? `${num(pr.units, 1)}-unit residential`
                : ((COMMERCIAL_BASELINES[pr.subType] || {}).name || 'Commercial');
            return `<div class="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
              <div class="min-w-0">
                <div class="text-xs font-bold truncate">${esc(label)} · ${money(pr.purchasePrice)}</div>
                <div class="text-[10px] text-zinc-500 truncate">loan ${money(pr.loanBalance)} ·
                  net <span class="${num(pr.netCashFlow) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${money(pr.netCashFlow)}</span>/turn</div>
              </div>
              <button data-prop-sell="${i}" class="text-[9px] bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-400 px-2 py-1 rounded shrink-0">Liquidate</button>
            </div>`;
          }).join('');

    $('props-list').querySelectorAll('[data-prop-sell]').forEach(b =>
        b.onclick = () => { if (confirm('Liquidate this property? Its loan is cleared from the proceeds.')) act({ kind: 'sellProperty', index: +b.dataset.propSell }); });
}

function renderHousing() {
    const p = me();
    const owning = p.housingStatus === 'owning';
    $('housing-status').innerHTML = owning
        ? `Owning — home valued at <b class="text-emerald-400">${money(p.homeValue)}</b>, housing cost ${money(p.housing)}/turn.`
        : `Renting at <b class="text-emerald-400">${money(p.monthlyRent)}</b>/mo — ${money(p.housing)}/turn.`;
    if (document.activeElement !== $('rent-input')) $('rent-input').value = Math.round(num(p.monthlyRent));

    const block = $('mortgage-block');
    if (owning && num(p.mortgages) > 0) {
        block.classList.remove('hide');
        const d = getMortgageTurnDetails(p.mortgages, p.mortgageRate, p.mortgagePI,
            num(state.config.taxInsRate) / 100, p.homeValue);
        $('mortgage-info').innerHTML = `
            <div class="flex justify-between"><span class="text-zinc-500">Balance:</span><span class="text-emerald-400 font-bold">${money(p.mortgages)}</span></div>
            <div class="flex justify-between"><span class="text-zinc-500">P&amp;I:</span><span>${money(p.mortgagePI)}/mo</span></div>
            <div class="flex justify-between"><span class="text-zinc-500">6-Mo PITI:</span><span class="text-amber-400">${money(d.piti6Mo)}</span></div>
            <div class="flex justify-between"><span class="text-zinc-500">Equity next turn:</span><span>${money(d.principal6Mo)}</span></div>`;
    } else {
        block.classList.add('hide');
    }
}

const LEDGER_FIELDS = [
    ['cash', 'Liquid Cash'], ['vti', 'VTI'], ['iyw', 'Tech ETF (IYW)'],
    ['ixc', 'Energy ETF (IXC)'], ['bonds', 'Bonds'], ['crypto', 'Crypto'],
    ['resi', 'Residential (invest)'], ['comm', 'Commercial (invest)'],
    ['homeValue', 'Primary Residence'], ['mortgages', 'Home Mortgage'],
    ['otherDebts', 'Other Debts'], ['salary', 'Annual Salary'],
    ['dividends', 'Annual Dividends'], ['rentalNet', 'Rental Net/Turn']
];

function renderLedgerFields() {
    const p = me();
    // Don't clobber a field the user is mid-edit in.
    if ($('ledger-fields').dataset.built === p.id && document.activeElement?.dataset?.led) return;

    $('ledger-fields').dataset.built = p.id;
    $('ledger-fields').innerHTML = LEDGER_FIELDS.map(([key, label]) => `
        <div>
          <label class="block text-[10px] text-zinc-400 mb-0.5">${label}</label>
          <input type="number" data-led="${key}" value="${Math.round(num(p[key]))}"
                 class="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs code-font">
        </div>`).join('') + `
        <div>
          <label class="block text-[10px] text-zinc-400 mb-0.5">Monthly Housing</label>
          <input type="number" data-led="housingMonthly" value="${Math.round(num(p.housing) / 6)}"
                 class="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs code-font">
        </div>
        <div>
          <label class="block text-[10px] text-zinc-400 mb-0.5">Monthly Food/Utils</label>
          <input type="number" data-led="fixedFoodMonthly" value="${Math.round(num(p.fixedFood, state.config.fixedFood) / 6)}"
                 class="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs code-font">
        </div>
        <div>
          <label class="block text-[10px] text-zinc-400 mb-0.5">Monthly Transport</label>
          <input type="number" data-led="transportation" value="${Math.round(num(p.transportation))}"
                 class="w-full bg-zinc-950 border border-zinc-800 rounded p-1.5 text-xs code-font">
        </div>`;
}

// --- previews ---------------------------------------------------------------

function updateLoanPreview() {
    const amortized = $('loan-type').value === 'amortized';
    const auto = $('loan-mode').value === 'auto';
    $('loan-term-row').classList.toggle('hide', !amortized);

    const principal = num($('loan-amount').value);
    const rate = num($('loan-rate').value) / 100;
    const term = Math.max(1, Math.round(num($('loan-term').value, 60)));
    const monthly = amortized ? calculateMonthlyPI(principal, rate, term) : principal * (rate / 12);

    $('loan-preview').innerHTML = `
        <div class="flex justify-between"><span class="text-zinc-500">Monthly:</span><span class="text-rose-400">${money(monthly)}</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Per turn:</span><span class="text-rose-400 font-bold">${money(monthly * 6)}</span></div>
        <div class="flex justify-between col-span-2"><span class="text-zinc-500">${auto ? 'Payoff:' : 'Manual:'}</span>
          <span class="${auto && amortized ? 'text-zinc-300' : 'text-amber-400'}">${
            !auto ? 'Interest accrues onto the balance until you pay it'
                  : amortized ? `${(term / 6).toFixed(1)} turns (${term} months)`
                              : 'Principal never amortizes'}</span></div>`;
}

function refreshPropSelect(resetPrice) {
    const cat = $('prop-category').value;
    const sel = $('prop-selection');
    $('prop-sel-label').textContent = cat === 'resi' ? 'Units' : 'Sector';
    const wantComm = cat === 'comm';
    const isComm = ['stripmall', 'medical', 'industrial', 'highrise'].includes(sel.value);

    if (wantComm !== isComm || sel.options.length === 0) {
        sel.innerHTML = wantComm
            ? Object.entries(COMMERCIAL_BASELINES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')
            : Object.keys(UNIT_BASELINES).map(k => `<option value="${k}">${k} unit${k === '1' ? '' : 's'}</option>`).join('');
        resetPrice = true;
    }
    if (resetPrice) {
        const price = baselinePropertyPrice(cat, sel.value, state || { resiMultiplier: 1, commMultiplier: 1 });
        $('prop-price').value = price;
        $('prop-down').value = Math.round(price * 0.2);
    }
    updatePropPreview();
}

function updatePropPreview() {
    if (!state) return;
    const cat = $('prop-category').value;
    const q = investmentPropertyQuote(cat, $('prop-selection').value,
        num($('prop-price').value), num($('prop-down').value), state.config);
    $('prop-preview').innerHTML = `
        <div class="flex justify-between"><span class="text-zinc-500">Rate:</span><span>${(q.annualRate * 100).toFixed(1)}%</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Loan:</span><span>${money(q.loanAmount)}</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Payment/turn:</span><span class="text-rose-400">${money(q.amortizedPayment)}</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Tax/ins:</span><span class="text-rose-400">${money(q.taxesIns)}</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Gross rent:</span><span class="text-emerald-400">${money(q.gross6MoRent)}</span></div>
        <div class="flex justify-between"><span class="text-zinc-500">Net/turn:</span>
          <span class="${q.netCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-bold">${money(q.netCashFlow)}</span></div>`;
}

// --- wiring -----------------------------------------------------------------

function setTxType(t) {
    txType = t;
    const on = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    const onSell = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    const off = 'bg-zinc-950 text-zinc-400 border-zinc-800';
    $('tx-buy').className = `py-2 text-xs font-bold rounded-lg border transition-all ${t === 'buy' ? on : off}`;
    $('tx-sell').className = `py-2 text-xs font-bold rounded-lg border transition-all ${t === 'sell' ? onSell : off}`;
}

function initGate() {
    $('gate-career').innerHTML = Object.entries(CAREERS)
        .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    $('gate-hobby').innerHTML = Object.entries(HOBBIES)
        .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

    const info = () => {
        const c = CAREERS[$('gate-career').value];
        const cfg = normalizeConfig(state ? state.config : null);
        $('gate-info').innerHTML = `
            <div class="flex justify-between"><span class="text-zinc-400">Annual salary</span><span class="font-bold">${money(c.salary)}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Starting cash</span><span class="font-bold text-emerald-400">${money(c.cash)}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Starting rent</span><span class="font-bold">${money(cfg.rentBaseline)}/mo</span></div>
            <p class="text-[10px] text-zinc-500 italic pt-1 border-t border-zinc-800 mt-1">${esc(c.perk)}</p>`;
    };
    $('gate-career').onchange = info;
    info();

    $('gate-join').onclick = () => {
        const name = $('gate-name').value.trim();
        if (!name) { $('gate-error').textContent = 'Enter a character name.'; $('gate-error').classList.remove('hide'); return; }
        $('gate-join').disabled = true;
        send({ type: 'join', name, career: $('gate-career').value, hobby: $('gate-hobby').value });
    };
    $('gate-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('gate-join').click(); });
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => {
                const on = b === btn;
                b.className = 'tab-btn px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap ' +
                    (on ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'text-zinc-400 hover:text-zinc-200');
            });
            document.querySelectorAll('.tab-panel').forEach(p =>
                p.classList.toggle('hide', p.dataset.panel !== btn.dataset.tab));
        };
    });
    document.querySelector('.tab-btn').click();
}

function initActions() {
    $('code-chip').onclick = async () => {
        try {
            await navigator.clipboard.writeText(location.origin + '/play/' + CODE);
            toast('Invite link copied');
        } catch { toast(`Session code: ${CODE}`); }
    };

    $('ready-btn').onclick = () => send({ type: 'ready', ready: !me().ready });
    $('force-advance-btn').onclick = () => {
        if (confirm('Reconcile the turn now, without waiting for everyone?')) send({ type: 'forceAdvance' });
    };

    $('tx-buy').onclick = () => setTxType('buy');
    $('tx-sell').onclick = () => setTxType('sell');
    $('tx-submit').onclick = () => {
        const amount = num($('tx-amount').value);
        if (amount <= 0) return toast('Enter an amount', 'err');
        act({ kind: txType === 'buy' ? 'buyAsset' : 'sellAsset', category: $('tx-category').value, amount });
        $('tx-amount').value = '';
    };
    $('paydebt-btn').onclick = () => {
        const amount = num($('paydebt-amount').value);
        if (amount <= 0) return toast('Enter an amount', 'err');
        act({ kind: 'payDebt', amount });
        $('paydebt-amount').value = '';
    };

    ['loan-amount', 'loan-rate', 'loan-term'].forEach(id => $(id).addEventListener('input', updateLoanPreview));
    ['loan-mode', 'loan-type'].forEach(id => $(id).addEventListener('change', updateLoanPreview));
    $('loan-submit').onclick = () => {
        const amount = num($('loan-amount').value);
        if (amount <= 0) return toast('Enter a loan amount', 'err');
        act({
            kind: 'borrow', amount,
            annualRate: num($('loan-rate').value),
            loanType: $('loan-type').value,
            mode: $('loan-mode').value,
            termMonths: num($('loan-term').value, 60)
        });
        $('loan-amount').value = '';
    };

    $('prop-category').addEventListener('change', () => refreshPropSelect(true));
    $('prop-selection').addEventListener('change', () => refreshPropSelect(true));
    ['prop-price', 'prop-down'].forEach(id => $(id).addEventListener('input', updatePropPreview));
    $('prop-submit').onclick = () => act({
        kind: 'buyProperty', category: $('prop-category').value,
        selection: $('prop-selection').value,
        price: num($('prop-price').value), downpayment: num($('prop-down').value)
    });

    $('set-renting').onclick = () => act({ kind: 'setHousing', status: 'renting', monthlyRent: num($('rent-input').value) });
    $('home-buy').onclick = () => {
        act({ kind: 'buyHome', price: num($('home-price').value), downPayment: num($('home-down').value) });
        $('home-price').value = ''; $('home-down').value = '';
    };
    $('extra-btn').onclick = () => {
        act({ kind: 'payExtraPrincipal', amount: num($('extra-principal').value) });
        $('extra-principal').value = '';
    };
    $('payoff-btn').onclick = () => { if (confirm('Pay off the mortgage in full?')) act({ kind: 'payoffMortgage' }); };

    $('ledger-save').onclick = () => {
        const fields = {};
        document.querySelectorAll('[data-led]').forEach(i => { fields[i.dataset.led] = num(i.value); });
        act({ kind: 'updateLedger', fields });
        toast('Ledger saved');
    };

    // Host settings
    const CFG_LABELS = {
        fixedFood: 'Food/Utils per turn', interestRate: 'Mortgage rate %', taxInsRate: 'Tax/Ins %',
        rentBaseline: 'Rent baseline $/mo', resiRentYield: 'Resi yield %/mo', commRentYield: 'Comm yield %/mo',
        fedStdDeduction: 'Fed deduction', gaStdDeduction: 'GA deduction', childTaxCredit: 'Child credit',
        ficaRate: 'FICA %', gaTaxRate: 'GA tax %'
    };
    $('host-settings-btn').onclick = () => {
        $('settings-fields').innerHTML = Object.entries(CFG_LABELS).map(([k, label]) => `
            <div>
              <label class="block text-[10px] text-zinc-400 mb-0.5">${label}</label>
              <input type="number" step="0.01" data-cfg="${k}" value="${num(state.config[k])}"
                     class="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs code-font">
            </div>`).join('');
        $('settings-modal').classList.remove('hide');
    };
    $('settings-close').onclick = () => $('settings-modal').classList.add('hide');
    $('settings-save').onclick = () => {
        const config = {};
        document.querySelectorAll('[data-cfg]').forEach(i => { config[i.dataset.cfg] = num(i.value); });
        send({ type: 'settings', config });
        $('settings-modal').classList.add('hide');
    };
}

// --- boot -------------------------------------------------------------------

if (!CODE) {
    location.href = '/';
} else {
    initGate();
    initTabs();
    initActions();
    setTxType('buy');
    updateLoanPreview();
    refreshPropSelect(true);
    connect();
}
