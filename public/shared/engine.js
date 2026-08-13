// Prosperity & Pathfinders - shared game engine.
//
// This module is the single source of truth for the game's economics. It is imported
// by the Cloudflare Worker (where it is authoritative - every mutation is applied
// server-side) and served to the browser for read-only previews such as the loan
// payment estimate and the property configurator.
//
// It is deliberately DOM-free and side-effect-free: every function takes plain state
// and returns plain data.

export const MARKET_CARDS = [
    { id: "2006_H1", label: "2006 H1", vti: 8, iyw: 5, ixc: 12, bonds: 1, resi: 4, comm: 5, rent: 2, crypto: -35 },
    { id: "2006_H2", label: "2006 H2", vti: 6, iyw: 6, ixc: 9, bonds: 2, resi: 3, comm: 4, rent: 3, crypto: 35 },
    { id: "2007_H1", label: "2007 H1", vti: 4, iyw: 7, ixc: 10, bonds: 2, resi: 2, comm: 3, rent: 3, crypto: -28 },
    { id: "2007_H2", label: "2007 H2", vti: -2, iyw: -1, ixc: 8, bonds: 3, resi: -1, comm: -2, rent: 2, crypto: -32 },
    { id: "2008_H1", label: "2008 H1", vti: -10, iyw: -12, ixc: 5, bonds: 3, resi: -4, comm: -7, rent: 1, crypto: 22 },
    { id: "2008_H2", label: "2008 H2", vti: -25, iyw: -28, ixc: -22, bonds: 6, resi: -8, comm: -12, rent: -2, crypto: -35 },
    { id: "2009_H1", label: "2009 H1", vti: 12, iyw: 18, ixc: -8, bonds: -1, resi: -5, comm: -10, rent: -3, crypto: 45 },
    { id: "2009_H2", label: "2009 H2", vti: 18, iyw: 22, ixc: 15, bonds: 2, resi: -3, comm: 2, rent: -1, crypto: 30 },
    { id: "2010_H1", label: "2010 H1", vti: 6, iyw: 8, ixc: -4, bonds: 4, resi: -2, comm: 1, rent: 1, crypto: -22 },
    { id: "2010_H2", label: "2010 H2", vti: 12, iyw: 14, ixc: 11, bonds: 2, resi: 1, comm: 4, rent: 2, crypto: 40 },
    { id: "2011_H1", label: "2011 H1", vti: 5, iyw: 6, ixc: 9, bonds: 3, resi: -1, comm: 2, rent: 3, crypto: -40 },
    { id: "2011_H2", label: "2011 H2", vti: -4, iyw: -5, ixc: -10, bonds: 4, resi: -2, comm: -3, rent: 4, crypto: 25 },
    { id: "2012_H1", label: "2012 H1", vti: 8, iyw: 11, ixc: -1, bonds: 2, resi: 2, comm: 4, rent: 4, crypto: 38 },
    { id: "2012_H2", label: "2012 H2", vti: 7, iyw: 9, ixc: 6, bonds: 1, resi: 3, comm: 5, rent: 5, crypto: 22 },
    { id: "2013_H1", label: "2013 H1", vti: 14, iyw: 13, ixc: 7, bonds: -1, resi: 4, comm: 6, rent: 5, crypto: -45 },
    { id: "2013_H2", label: "2013 H2", vti: 16, iyw: 18, ixc: 9, bonds: 1, resi: 4, comm: 5, rent: 4, crypto: 32 },
    { id: "2014_H1", label: "2014 H1", vti: 7, iyw: 9, ixc: 10, bonds: 3, resi: 3, comm: 5, rent: 4, crypto: -15 },
    { id: "2014_H2", label: "2014 H2", vti: 6, iyw: 7, ixc: -5, bonds: 2, resi: 3, comm: 4, rent: 5, crypto: 28 },
    { id: "2015_H1", label: "2015 H1", vti: 2, iyw: 4, ixc: -3, bonds: 1, resi: 3, comm: 2, rent: 5, crypto: -28 },
    { id: "2015_H2", label: "2015 H2", vti: -1, iyw: 3, ixc: -12, bonds: 1, resi: 3, comm: 1, rent: 6, crypto: 35 },
    { id: "2016_H1", label: "2016 H1", vti: 4, iyw: 5, ixc: 12, bonds: 4, resi: 3, comm: 3, rent: 5, crypto: 25 },
    { id: "2016_H2", label: "2016 H2", vti: 8, iyw: 9, ixc: 7, bonds: 1, resi: 4, comm: 4, rent: 4, crypto: -20 },
    { id: "2017_H1", label: "2017 H1", vti: 9, iyw: 14, ixc: -4, bonds: 2, resi: 4, comm: 4, rent: 4, crypto: 12 },
    { id: "2017_H2", label: "2017 H2", vti: 10, iyw: 13, ixc: 8, bonds: 1, resi: 4, comm: 5, rent: 5, crypto: 10 },
    { id: "2018_H1", label: "2018 H1", vti: 3, iyw: 8, ixc: 6, bonds: -1, resi: 3, comm: 2, rent: 4, crypto: -45 },
    { id: "2018_H2", label: "2018 H2", vti: -8, iyw: -10, ixc: -15, bonds: 2, resi: 2, comm: -4, rent: 3, crypto: -28 },
    { id: "2019_H1", label: "2019 H1", vti: 14, iyw: 18, ixc: 8, bonds: 4, resi: 3, comm: 5, rent: 4, crypto: 38 },
    { id: "2019_H2", label: "2019 H2", vti: 10, iyw: 14, ixc: 4, bonds: 3, resi: 3, comm: 4, rent: 5, crypto: -22 },
    { id: "2020_H1", label: "2020 H1", vti: -12, iyw: 2, ixc: -25, bonds: 6, resi: 1, comm: -8, rent: 2, crypto: -15 },
    { id: "2020_H2", label: "2020 H2", vti: 22, iyw: 25, ixc: 18, bonds: 2, resi: 6, comm: 4, rent: 6, crypto: 32 },
    { id: "2021_H1", label: "2021 H1", vti: 14, iyw: 12, ixc: 22, bonds: -2, resi: 8, comm: 7, rent: 8, crypto: 25 },
    { id: "2021_H2", label: "2021 H2", vti: 9, iyw: 13, ixc: 6, bonds: 1, resi: 7, comm: 5, rent: 10, crypto: -32 },
    { id: "2022_H1", label: "2022 H1", vti: -18, iyw: -22, ixc: 20, bonds: -8, resi: 4, comm: -6, rent: 12, crypto: -48 },
    { id: "2022_H2", label: "2022 H2", vti: 2, iyw: -3, ixc: 12, bonds: -4, resi: -1, comm: -9, rent: 7, crypto: -22 },
    { id: "2023_H1", label: "2023 H1", vti: 12, iyw: 25, ixc: -3, bonds: 3, resi: 2, comm: -2, rent: 5, crypto: 22 },
    { id: "2023_H2", label: "2023 H2", vti: 11, iyw: 16, ixc: 5, bonds: 2, resi: 3, comm: -1, rent: 3, crypto: 35 },
    { id: "2024_H1", label: "2024 H1", vti: 12, iyw: 17, ixc: 8, bonds: -1, resi: 3, comm: 3, rent: 2, crypto: -25 },
    { id: "2024_H2", label: "2024 H2", vti: 10, iyw: 11, ixc: 4, bonds: 2, resi: 3, comm: 3, rent: 1, crypto: 12 },
    { id: "2025_H1", label: "2025 H1", vti: 7, iyw: 9, ixc: 3, bonds: 2, resi: 2, comm: 2, rent: 1, crypto: 8 },
    { id: "2025_H2", label: "2025 H2", vti: 6, iyw: 7, ixc: 5, bonds: 2, resi: 2, comm: 2, rent: 0, crypto: 20 },
    { id: "2026_H1", label: "2026 H1", vti: 5, iyw: 8, ixc: -2, bonds: 1, resi: 2, comm: 1, rent: -2, crypto: -15 }
];

export const UNIT_BASELINES = {
    "1": 250000, "2": 460000, "4": 700000, "8": 1000000,
    "12": 1300000, "48": 3500000, "100": 6000000
};

export const COMMERCIAL_BASELINES = {
    stripmall: { name: "Strip Mall", price: 1000000 },
    medical: { name: "Medical Office", price: 2500000 },
    industrial: { name: "Industrial Warehouse", price: 5000000 },
    highrise: { name: "High-Rise Office Tower", price: 12000000 }
};

// salary is ANNUAL; every cash-flow path divides it by 2 for a 6-month turn.
export const CAREERS = {
    tradesman: { name: "The Tradesman", salary: 60000, cash: 10000, modifiers: { deal: -1, diy: 3, tech: 0, grit: 0 }, perk: "Handyman Direct: -50% maintenance; may personally handle repairs to skip the cost." },
    service: { name: "The Service Worker", salary: 70000, cash: 10000, modifiers: { deal: 0, diy: 0, tech: -1, grit: 3 }, perk: "Hustler's Drive: Can pick up extra work to push through a tight turn." },
    climber: { name: "The Corporate Climber", salary: 80000, cash: 10000, modifiers: { deal: 3, diy: 0, tech: 0, grit: 1 }, perk: "Art of the Deal: Re-roll 1 failed negotiation check per turn." },
    tech: { name: "The Tech Specialist", salary: 90000, cash: 10000, modifiers: { deal: 0, diy: -2, tech: 3, grit: 0 }, perk: "Systems Scaler: E-commerce side-hustles run at reduced effort." }
};

export const HOBBIES = {
    garage: { name: "Garage Tinkerer", mod: { diy: 1 } },
    networker: { name: "Local Networker", mod: { grit: 1 } },
    blogger: { name: "Tech Blogger", mod: { tech: 1 } },
    flipper: { name: "Thrift Store Flipper", mod: { deal: 1 } }
};

export const DEFAULT_CONFIG = {
    fixedFood: 16000,
    interestRate: 5.0,
    taxInsRate: 1.5,
    rentBaseline: 1800,
    fedStdDeduction: 29200,
    gaStdDeduction: 24000,
    childTaxCredit: 4000,
    ficaRate: 7.65,
    gaTaxRate: 5.39,
    resiRentYield: 1.0,
    commRentYield: 1.2
};

// --- primitives -------------------------------------------------------------

export function num(value, fallback = 0) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

// A config missing keys would otherwise reach the tax math and turn every balance
// in the game into NaN.
export function normalizeConfig(cfg) {
    const merged = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    for (const k of Object.keys(DEFAULT_CONFIG)) {
        if (!Number.isFinite(merged[k])) merged[k] = DEFAULT_CONFIG[k];
    }
    return merged;
}

// --- taxes ------------------------------------------------------------------

export function calculate6MoTaxes(sixMonthSalary, config) {
    const cfg = normalizeConfig(config);
    const annualSalary = num(sixMonthSalary) * 2;

    const federalTaxable = Math.max(0, annualSalary - cfg.fedStdDeduction);
    let federalTax;
    if (federalTaxable <= 23200) {
        federalTax = federalTaxable * 0.10;
    } else if (federalTaxable <= 94300) {
        federalTax = (23200 * 0.10) + ((federalTaxable - 23200) * 0.12);
    } else {
        federalTax = (23200 * 0.10) + ((94300 - 23200) * 0.12) + ((federalTaxable - 94300) * 0.22);
    }
    federalTax = Math.max(0, federalTax - cfg.childTaxCredit);

    const gaTaxable = Math.max(0, annualSalary - cfg.gaStdDeduction);
    const gaTax = gaTaxable * (cfg.gaTaxRate / 100);
    const fica = annualSalary * (cfg.ficaRate / 100);

    return Math.round(num(federalTax + gaTax + fica) / 2);
}

// --- mortgages --------------------------------------------------------------

export function calculateMonthlyPI(principal, annualRate, termMonths) {
    if (num(principal) <= 0) return 0;
    const r = num(annualRate) / 12;
    if (r === 0) return num(principal) / termMonths;
    return (num(principal) * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export function getMortgageTurnDetails(balance, annualRate, monthlyPI, annualTaxInsRate, homePrice) {
    let currentBalance = num(balance);
    let totalInterest = 0, totalPrincipal = 0, totalPaid = 0;
    let underwater = false;
    const monthlyRate = num(annualRate) / 12;
    const pmt = num(monthlyPI);

    for (let i = 0; i < 6; i++) {
        if (currentBalance <= 0) break;
        const interest = currentBalance * monthlyRate;
        // A payment that cannot cover accrued interest would grow the balance forever.
        if (pmt <= interest) underwater = true;
        const principalPortion = Math.max(0, Math.min(currentBalance, pmt - interest));
        const paidThisMonth = Math.min(pmt, interest + principalPortion);

        currentBalance -= principalPortion;
        totalInterest += interest;
        totalPrincipal += principalPortion;
        totalPaid += paidThisMonth;
    }

    const taxIns6Mo = (num(homePrice) * num(annualTaxInsRate)) / 2;
    // Bill only what was actually paid, so a cleared balance stops charging P&I.
    return {
        piti6Mo: Math.round(totalPaid + taxIns6Mo),
        interest6Mo: Math.round(totalInterest),
        principal6Mo: Math.round(totalPrincipal),
        taxIns6Mo: Math.round(taxIns6Mo),
        endingBalance: Math.round(currentBalance),
        underwater
    };
}

export function resyncPrimaryMortgage(player, config) {
    const cfg = normalizeConfig(config);
    if (player.housingStatus !== 'owning' || num(player.mortgages) <= 0) {
        player.mortgagePI = 0;
        return;
    }
    const rate = num(player.mortgageRate, cfg.interestRate / 100);
    player.mortgageRate = rate;
    const monthlyInterest = num(player.mortgages) * (rate / 12);
    if (num(player.mortgagePI) <= monthlyInterest) {
        player.mortgagePI = calculateMonthlyPI(player.mortgages, rate, 360);
    }
}

export function refreshOwnedHousingCost(player, config) {
    const cfg = normalizeConfig(config);
    if (num(player.mortgages) > 0 && num(player.mortgagePI) > 0) {
        player.housing = getMortgageTurnDetails(
            player.mortgages, player.mortgageRate, player.mortgagePI,
            cfg.taxInsRate / 100, player.homeValue
        ).piti6Mo;
    } else {
        player.mortgagePI = 0;
        player.housing = Math.round(num(player.homeValue) * (cfg.taxInsRate / 200));
    }
}

// --- investment properties --------------------------------------------------

// Each property services its own loan. Rolling these into player.mortgages would
// starve the primary-residence payment and grow that balance forever.
export function amortizePropertyLoan(prop) {
    const balance = num(prop.loanBalance);
    if (balance <= 0) {
        prop.loanBalance = 0;
        prop.amortizedPayment = 0;
        return 0;
    }
    const ratePerTurn = num(prop.annualRate) / 2;
    const interest = balance * ratePerTurn;
    const principal = Math.max(0, Math.min(balance, num(prop.amortizedPayment) - interest));
    prop.loanBalance = Math.round(balance - principal);
    if (prop.loanBalance <= 0) {
        prop.loanBalance = 0;
        prop.amortizedPayment = 0;
    }
    return principal;
}

export function recomputeInvestmentTotals(player) {
    const props = player.properties || [];
    player.investmentDebt = props.reduce((t, p) => t + num(p.loanBalance), 0);
    player.rentalNet = props.reduce((t, p) => t + num(p.netCashFlow), 0);
}

export function investmentPropertyQuote(category, selection, price, downpayment, config) {
    const cfg = normalizeConfig(config);
    let annualRate = cfg.interestRate / 100;
    let taxInsRate = cfg.taxInsRate / 100;
    let grossMonthlyRentRate;

    if (category === 'resi') {
        annualRate += (selection === "1" || selection === "2" || selection === "4") ? 0.005 : 0.015;
        grossMonthlyRentRate = cfg.resiRentYield / 100;
    } else {
        annualRate += 0.02;
        taxInsRate = (cfg.taxInsRate + 0.5) / 100;
        grossMonthlyRentRate = cfg.commRentYield / 100;
    }

    const loanAmount = Math.max(0, num(price) - num(downpayment));
    const ratePerTurn = annualRate / 2;
    const amortizedPayment = loanAmount > 0
        ? Math.round(loanAmount * (ratePerTurn * Math.pow(1 + ratePerTurn, 60)) / (Math.pow(1 + ratePerTurn, 60) - 1))
        : 0;
    const taxesIns = Math.round(num(price) * (taxInsRate / 2));
    const gross6MoRent = Math.round(num(price) * (grossMonthlyRentRate * 6));

    return {
        annualRate, taxInsRate, loanAmount, amortizedPayment, taxesIns,
        gross6MoRent,
        netCashFlow: Math.round(gross6MoRent - amortizedPayment - taxesIns)
    };
}

export function baselinePropertyPrice(category, selection, state) {
    if (category === 'resi') {
        return Math.round((UNIT_BASELINES[selection] || 250000) * num(state.resiMultiplier, 1));
    }
    return Math.round(((COMMERCIAL_BASELINES[selection] || {}).price || 1000000) * num(state.commMultiplier, 1));
}

// --- general loans ----------------------------------------------------------

export function loanPaymentPerTurn(loan) {
    const balance = num(loan.balance);
    if (balance <= 0) return 0;
    const annualRate = num(loan.annualRate);
    if (loan.type === 'interest') return Math.round(balance * (annualRate / 2));
    const monthly = num(loan.monthlyPayment,
        calculateMonthlyPI(loan.principal, annualRate, num(loan.termMonths, 60)));
    return Math.round(monthly * 6);
}

// Advances one 6-month turn. Unpaid interest capitalises onto the balance.
export function advanceLoanOneTurn(loan, isPaid) {
    let balance = num(loan.balance);
    if (balance <= 0) { loan.balance = 0; return 0; }

    const monthlyRate = num(loan.annualRate) / 12;
    const monthlyPayment = loan.type === 'interest'
        ? balance * monthlyRate
        : num(loan.monthlyPayment, calculateMonthlyPI(loan.principal, loan.annualRate, num(loan.termMonths, 60)));

    let paid = 0;
    for (let m = 0; m < 6; m++) {
        if (balance <= 0) break;
        const interest = balance * monthlyRate;
        if (!isPaid) { balance += interest; continue; }
        if (loan.type === 'interest') { paid += interest; continue; }
        const principalPortion = Math.max(0, Math.min(balance, monthlyPayment - interest));
        paid += Math.min(monthlyPayment, interest + principalPortion);
        balance -= principalPortion;
    }

    loan.balance = Math.max(0, Math.round(balance));
    return Math.round(paid);
}

export function describeLoan(loan) {
    const rate = `${(num(loan.annualRate) * 100).toFixed(1)}%`;
    return loan.type === 'interest' ? `${rate} interest-only` : `${rate} over ${num(loan.termMonths, 60)} mo`;
}

export function recomputeLoanTotals(player) {
    const loans = player.loans || [];
    player.loanDebt = loans.reduce((t, l) => t + num(l.balance), 0);
    player.loanPaymentPerTurn = loans.reduce(
        (t, l) => t + (l.mode === 'auto' ? loanPaymentPerTurn(l) : 0), 0);
}

// --- aggregates -------------------------------------------------------------

export function calculatePlayerDebt(p) {
    return Math.round(num(p.mortgages) + num(p.otherDebts) + num(p.investmentDebt) + num(p.loanDebt));
}

export function calculatePlayerNetWorth(p) {
    const assets = num(p.cash) + num(p.vti) + num(p.iyw) + num(p.ixc) + num(p.bonds)
        + num(p.resi) + num(p.comm) + num(p.crypto) + num(p.homeValue);
    return Math.round(assets - calculatePlayerDebt(p));
}

export function calculateTurnCashFlow(p, config) {
    const cfg = normalizeConfig(config);
    const foodPerTurn = num(p.fixedFood, cfg.fixedFood);
    const income = (num(p.salary) / 2) + num(p.rentalNet) + (num(p.dividends) / 2);
    const expenses = calculate6MoTaxes(num(p.salary) / 2, cfg)
        + num(p.housing)
        + foodPerTurn
        + (num(p.transportation) * 6)
        + num(p.loanPaymentPerTurn);
    return Math.round(income - expenses);
}

export function playerMetrics(p) {
    return {
        cash: Math.round(num(p.cash)),
        netWorth: calculatePlayerNetWorth(p),
        stocks: Math.round(num(p.vti) + num(p.iyw) + num(p.ixc)),
        bonds: Math.round(num(p.bonds)),
        crypto: Math.round(num(p.crypto)),
        realEstate: Math.round(num(p.resi) + num(p.comm) + num(p.homeValue)),
        rentalNet: Math.round(num(p.rentalNet)),
        totalDebt: calculatePlayerDebt(p)
    };
}

// --- player construction ----------------------------------------------------

export function createPlayer({ id, name, career, hobby }, config) {
    const cfg = normalizeConfig(config);
    const defaults = CAREERS[career] || CAREERS.tradesman;
    return {
        id, name,
        career: CAREERS[career] ? career : 'tradesman',
        hobby: HOBBIES[hobby] ? hobby : 'garage',
        age: 22,

        salary: defaults.salary,
        rentalNet: 0,
        dividends: 0,

        housingStatus: 'renting',
        monthlyRent: cfg.rentBaseline,
        homePurchasePrice: 0,
        homeValue: 0,
        properties: [],

        taxes: calculate6MoTaxes(defaults.salary / 2, cfg),
        housing: cfg.rentBaseline * 6,
        fixedFood: cfg.fixedFood,
        transportation: 350,

        cash: defaults.cash,
        vti: 0, iyw: 0, ixc: 0, bonds: 0, resi: 0, comm: 0, crypto: 0,

        mortgages: 0,
        mortgagePI: 0,
        mortgageRate: 0,
        otherDebts: 0,
        investmentDebt: 0,
        loans: [],
        loanDebt: 0,
        loanPaymentPerTurn: 0,

        prevMetrics: null,
        ready: false
    };
}

// --- the turn ---------------------------------------------------------------

export function pickRandomCard() {
    return MARKET_CARDS[Math.floor(Math.random() * MARKET_CARDS.length)];
}

// Applies one 6-month turn to a single player. Returns log lines describing it.
export function applyCardToPlayer(p, card, config) {
    const cfg = normalizeConfig(config);
    const taxInsRate = cfg.taxInsRate;
    const log = [];

    p.prevMetrics = playerMetrics(p);

    p.vti = Math.round(num(p.vti) * (1 + card.vti / 100));
    p.iyw = Math.round(num(p.iyw) * (1 + card.iyw / 100));
    p.ixc = Math.round(num(p.ixc) * (1 + card.ixc / 100));
    p.bonds = Math.round(num(p.bonds) * (1 + card.bonds / 100));
    p.resi = Math.round(num(p.resi) * (1 + card.resi / 100));
    p.comm = Math.round(num(p.comm) * (1 + card.comm / 100));
    p.crypto = Math.round(num(p.crypto) * (1 + card.crypto / 100));
    p.homeValue = Math.round(num(p.homeValue) * (1 + card.resi / 100));

    if (p.properties && p.properties.length > 0) {
        for (const prop of p.properties) {
            const mult = prop.type === 'commercial' ? (1 + card.comm / 100) : (1 + card.resi / 100);
            prop.purchasePrice = Math.round(num(prop.purchasePrice) * mult);
            prop.currentGrossRent = Math.round(num(prop.currentGrossRent) * (1 + card.rent / 100));
            prop.taxesIns = Math.round(num(prop.purchasePrice) * (num(prop.taxInsRate, taxInsRate / 100) / 2));
            amortizePropertyLoan(prop);
            prop.netCashFlow = Math.round(num(prop.currentGrossRent) - num(prop.amortizedPayment) - num(prop.taxesIns));
        }
        recomputeInvestmentTotals(p);
    }

    if (p.housingStatus === 'renting') {
        p.monthlyRent = Math.round(num(p.monthlyRent, cfg.rentBaseline) * (1 + card.rent / 100));
        p.housing = p.monthlyRent * 6;
    } else if (p.housingStatus === 'owning') {
        resyncPrimaryMortgage(p, cfg);
        if (num(p.mortgages) > 0 && num(p.mortgagePI) > 0) {
            const details = getMortgageTurnDetails(
                p.mortgages, p.mortgageRate, p.mortgagePI, taxInsRate / 100, p.homeValue);
            p.housing = details.piti6Mo;
            const principalPaid = num(p.mortgages) - details.endingBalance;
            p.mortgages = details.endingBalance;
            if (p.mortgages <= 0) {
                p.mortgagePI = 0;
                log.push(`${p.name} made the final payment on their primary residence.`);
            } else {
                log.push(`${p.name} built $${principalPaid.toLocaleString()} in home equity.`);
            }
        } else {
            p.mortgagePI = 0;
            p.housing = Math.round(num(p.homeValue) * (taxInsRate / 200));
        }
    }

    recomputeLoanTotals(p);
    const netCashFlow = calculateTurnCashFlow(p, cfg);

    for (const loan of (p.loans || [])) {
        const opening = num(loan.balance);
        advanceLoanOneTurn(loan, loan.mode === 'auto');
        if (loan.mode === 'auto' && num(loan.balance) <= 0 && opening > 0) {
            log.push(`${p.name} retired a ${describeLoan(loan)} loan.`);
        } else if (loan.mode === 'manual' && num(loan.balance) > opening) {
            log.push(`${p.name}'s manual ${describeLoan(loan)} loan grew to $${num(loan.balance).toLocaleString()} on unpaid interest.`);
        }
    }
    p.loans = (p.loans || []).filter(l => num(l.balance) > 0);
    recomputeLoanTotals(p);

    p.cash = Math.round(num(p.cash) + netCashFlow);
    p.age = parseFloat((num(p.age, 22) + 0.5).toFixed(1));

    log.unshift(`${p.name}: net cash flow ${netCashFlow >= 0 ? '+' : '-'}$${Math.abs(netCashFlow).toLocaleString()}.`);
    return log;
}
