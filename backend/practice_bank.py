"""Technical practice problems with fresh numbers each time.

Each template is a function of a seeded random generator, so a question can be rebuilt exactly from its
key ("tpl:<name>:<seed>") to grade it later, and "try a similar problem" is the same template with a new seed.
The numbers are picked so the arithmetic works out by hand. Questions are written for this app in the
standard style of IB technical interviews; they are not copied from any guide.
"""
import random
from dataclasses import dataclass
from typing import Callable

TAX = 25  # percent, kept fixed so the math stays clean


@dataclass
class Problem:
    question: str
    answer: str          # the short answer, for grading
    solution: str        # the worked explanation
    numbers: list[float]  # the key figure(s) a correct answer must contain


def _m(x: float) -> str:
    """$ amount in millions, without trailing .0."""
    x = round(x, 2)
    return f"${x:,.0f}M" if float(x).is_integer() else f"${x:,.1f}M"


def _pct(x: float) -> str:
    return f"{x:g}%"


# ---------------- Accounting ----------------

def depreciation_up(r: random.Random) -> Problem:
    d = r.choice([10, 20, 40, 80, 100])
    after = d * (1 - TAX / 100)
    return Problem(
        f"Depreciation goes up by {_m(d)}. Walk me through the three statements (tax rate {TAX}%).",
        f"Net income falls {_m(after)}; cash rises {_m(d - after)}; PP&E falls {_m(d)}.",
        f"Income statement: operating income falls {_m(d)}, so taxes fall {_m(d * TAX / 100)} and net income falls {_m(after)}.\n"
        f"Cash flow statement: start with net income down {_m(after)}, add back the {_m(d)} non-cash depreciation, so cash is up {_m(d - after)} (the tax saving).\n"
        f"Balance sheet: cash up {_m(d - after)}, PP&E down {_m(d)}, so assets are down {_m(after)}. Retained earnings are down {_m(after)}, so it balances.",
        [after, d - after],
    )


def sell_inventory(r: random.Random) -> Problem:
    cost = r.choice([20, 40, 60, 80])
    price = cost + r.choice([20, 40])
    profit = price - cost
    ni = profit * (1 - TAX / 100)
    return Problem(
        f"A company sells inventory that cost {_m(cost)} for {_m(price)} in cash. Walk me through the three statements (tax rate {TAX}%).",
        f"Net income up {_m(ni)}; cash up {_m(ni + cost)}; inventory down {_m(cost)}.",
        f"Income statement: revenue {_m(price)}, COGS {_m(cost)}, pre-tax profit {_m(profit)}, taxes {_m(profit * TAX / 100)}, net income up {_m(ni)}.\n"
        f"Cash flow statement: net income up {_m(ni)}, and the decrease in inventory is a {_m(cost)} source of cash, so cash is up {_m(ni + cost)}.\n"
        f"Balance sheet: cash up {_m(ni + cost)}, inventory down {_m(cost)}, assets up {_m(ni)}. Retained earnings up {_m(ni)}.",
        [ni, ni + cost],
    )


def inventory_writedown(r: random.Random) -> Problem:
    w = r.choice([20, 40, 80, 100, 200])
    after = w * (1 - TAX / 100)
    return Problem(
        f"A company writes down {_m(w)} of inventory. Walk me through the three statements (tax rate {TAX}%).",
        f"Net income falls {_m(after)}; cash rises {_m(w - after)}; inventory down {_m(w)}.",
        f"Income statement: a {_m(w)} expense (usually in COGS) lowers pre-tax income {_m(w)}, taxes fall {_m(w * TAX / 100)}, net income falls {_m(after)}.\n"
        f"Cash flow statement: net income down {_m(after)}, add back the {_m(w)} non-cash write-down, cash up {_m(w - after)}.\n"
        f"Balance sheet: cash up {_m(w - after)}, inventory down {_m(w)}, so assets down {_m(after)}; retained earnings down {_m(after)}.",
        [after, w - after],
    )


def sbc(r: random.Random) -> Problem:
    s = r.choice([20, 40, 60, 100])
    after = s * (1 - TAX / 100)
    return Problem(
        f"A company records {_m(s)} of stock-based compensation. Walk me through the three statements (tax rate {TAX}%, assume it is tax deductible now).",
        f"Net income falls {_m(after)}; cash rises {_m(s - after)}; equity net up {_m(s - after)}.",
        f"Income statement: operating expenses up {_m(s)}, taxes down {_m(s * TAX / 100)}, net income down {_m(after)}.\n"
        f"Cash flow statement: net income down {_m(after)}, add back {_m(s)} of non-cash SBC, cash up {_m(s - after)}.\n"
        f"Balance sheet: cash up {_m(s - after)}. Equity: retained earnings down {_m(after)} but common stock/APIC up {_m(s)}, net up {_m(s - after)}. Balanced.",
        [after, s - after],
    )


def debt_interest(r: random.Random) -> Problem:
    debt = r.choice([100, 200, 400, 500])
    rate = r.choice([4, 6, 8, 10])
    repay = r.choice([20, 40, 50])
    interest = debt * rate / 100
    ni = interest * (1 - TAX / 100)
    return Problem(
        f"A company has {_m(debt)} of debt at {rate}% interest. This year it pays the interest and repays {_m(repay)} of principal. "
        f"Walk me through the three statements (tax rate {TAX}%).",
        f"Net income falls {_m(ni)}; cash falls {_m(ni + repay)}; debt falls {_m(repay)}.",
        f"Income statement: interest expense {_m(interest)}, taxes down {_m(interest * TAX / 100)}, net income down {_m(ni)}.\n"
        f"Cash flow statement: net income down {_m(ni)} in operations; the {_m(repay)} principal repayment is a financing outflow. Cash down {_m(ni + repay)}.\n"
        f"Balance sheet: cash down {_m(ni + repay)}; debt down {_m(repay)}; retained earnings down {_m(ni)}. Both sides fall {_m(ni + repay)}.",
        [ni, ni + repay],
    )


def buy_ppe_debt(r: random.Random) -> Problem:
    p = r.choice([50, 100, 200, 500])
    return Problem(
        f"A company buys {_m(p)} of PP&E with new debt. What happens on the three statements, right when it happens?",
        "No income statement change. Cash flow: -capex, +debt, net zero. Balance sheet: PP&E and debt both up.",
        f"Income statement: nothing yet (depreciation and interest come later).\n"
        f"Cash flow statement: capital expenditures of {_m(p)} (investing outflow) and {_m(p)} of debt raised (financing inflow), net change in cash 0.\n"
        f"Balance sheet: PP&E up {_m(p)} and debt up {_m(p)}. Balanced.",
        [p],
    )


# ---------------- Enterprise and equity value ----------------

def ev_bridge(r: random.Random) -> Problem:
    eq = r.choice([800, 1000, 1200, 1500, 2000])
    debt = r.choice([200, 300, 400, 500])
    cash = r.choice([50, 100, 150])
    pref = r.choice([0, 50, 100])
    nci = r.choice([0, 25, 50])
    ev = eq + debt + pref + nci - cash
    extras = (f", {_m(pref)} of preferred stock" if pref else "") + (f", {_m(nci)} of noncontrolling interest" if nci else "")
    return Problem(
        f"A company has an equity value of {_m(eq)}, {_m(debt)} of debt, {_m(cash)} of cash{extras}. What is its enterprise value?",
        f"{_m(ev)}",
        f"Enterprise value = equity value + debt + preferred stock + noncontrolling interest - cash.\n"
        f"= {eq:g} + {debt:g}" + (f" + {pref:g}" if pref else "") + (f" + {nci:g}" if nci else "") + f" - {cash:g} = {_m(ev)}.\n"
        "Debt, preferred and NCI are other claims on the business; cash is subtracted because it is not part of the core operations.",
        [ev],
    )


def ev_change(r: random.Random) -> Problem:
    amt = r.choice([50, 100, 200])
    use = r.choice(["buyback", "cash", "dividend"])
    if use == "buyback":
        q = f"A company raises {_m(amt)} of new debt and uses all of it to buy back shares. What happens to equity value and enterprise value?"
        a = f"Equity value falls {_m(amt)}; enterprise value does not change."
        s = (f"Equity value falls {_m(amt)} because shares worth that much are retired. Debt rises {_m(amt)}. "
             f"EV = equity + debt - cash, so -{amt:g} + {amt:g} = 0: enterprise value is unchanged.")
    elif use == "cash":
        q = f"A company raises {_m(amt)} of new debt and keeps it as cash on the balance sheet. What happens to equity value and enterprise value?"
        a = "Neither changes."
        s = f"Equity value is unchanged (no shares issued or bought). Debt up {_m(amt)}, cash up {_m(amt)}: EV changes by +{amt:g} - {amt:g} = 0."
    else:
        q = f"A company pays a {_m(amt)} cash dividend. What happens to equity value and enterprise value?"
        a = f"Equity value falls {_m(amt)}; enterprise value does not change."
        s = f"Cash leaves the company, so equity value falls {_m(amt)}. Cash is also down {_m(amt)}: EV changes by -{amt:g} + {amt:g} = 0."
    return Problem(q, a, s, [amt])


# ---------------- Valuation ----------------

def implied_price_ev_ebitda(r: random.Random) -> Problem:
    ebitda = r.choice([50, 80, 100, 120, 150])
    mult = r.choice([8, 10, 12])
    net_debt = r.choice([100, 200, 300])
    shares = r.choice([10, 20, 25, 50])
    ev = ebitda * mult
    eq = ev - net_debt
    while eq % shares:
        net_debt += 10
        eq = ev - net_debt
    price = eq / shares
    return Problem(
        f"Comparable companies trade at {mult}x EBITDA. Your company has {_m(ebitda)} of EBITDA, {_m(net_debt)} of net debt and {shares} million shares. "
        "What is the implied share price?",
        f"${price:,.2f} per share",
        f"Implied EV = {mult} x {ebitda:g} = {_m(ev)}.\nEquity value = EV - net debt = {ev:g} - {net_debt:g} = {_m(eq)}.\n"
        f"Price = {eq:g} / {shares} = ${price:,.2f} per share.",
        [price],
    )


def implied_price_pe(r: random.Random) -> Problem:
    eps = r.choice([2, 2.5, 4, 5])
    pe = r.choice([12, 15, 18, 20])
    price = eps * pe
    return Problem(
        f"Peers trade at {pe}x forward earnings. Your company's forward EPS is ${eps:g}. What is the implied share price, and when would P/E be a poor metric?",
        f"${price:g} per share",
        f"Implied price = {pe} x ${eps:g} = ${price:g}.\nP/E is distorted by capital structure (interest), non-cash and one-time items, and does not work when earnings are negative; "
        "EV/EBITDA is capital-structure neutral, which is why bankers lean on it.",
        [price],
    )


def ev_or_equity_multiple(r: random.Random) -> Problem:
    pairs = [("Revenue", "EV"), ("EBITDA", "EV"), ("Net income", "Equity value"), ("Unlevered free cash flow", "EV"),
             ("Levered free cash flow", "Equity value"), ("EBIT", "EV")]
    metric, ans = r.choice(pairs)
    why = "it is available to all capital providers (before interest)" if ans == "EV" else "it is after interest, so it belongs to equity holders only"
    return Problem(
        f"Should {metric} be paired with enterprise value or equity value in a multiple? Why?",
        ans,
        f"{ans}, because {why}. Match the numerator and the denominator: metrics before interest go with EV, after interest with equity value.",
        [],
    )


# ---------------- DCF ----------------

def ufcf(r: random.Random) -> Problem:
    ebit = r.choice([100, 200, 400])
    da = r.choice([20, 30, 40])
    capex = r.choice([30, 40, 50, 60])
    nwc = r.choice([10, 20])
    nopat = ebit * (1 - TAX / 100)
    fcf = nopat + da - capex - nwc
    return Problem(
        f"EBIT is {_m(ebit)}, D&A {_m(da)}, capex {_m(capex)}, and net working capital rises {_m(nwc)}. Tax rate {TAX}%. What is unlevered free cash flow?",
        f"{_m(fcf)}",
        f"NOPAT = EBIT x (1 - tax) = {ebit:g} x 0.75 = {_m(nopat)}.\nUFCF = NOPAT + D&A - capex - increase in NWC = {nopat:g} + {da:g} - {capex:g} - {nwc:g} = {_m(fcf)}.",
        [fcf],
    )


def gordon_tv(r: random.Random) -> Problem:
    fcf = r.choice([50, 100, 150, 200])
    wacc, g = r.choice([(10, 2), (10, 5), (9, 4), (8, 3), (12, 2)])
    tv = fcf / ((wacc - g) / 100)
    return Problem(
        f"Next year's free cash flow is {_m(fcf)}, the discount rate is {wacc}% and long-term growth is {g}%. What is the terminal value (perpetuity growth method)?",
        f"{_m(tv)}",
        f"TV = FCF next year / (discount rate - growth) = {fcf:g} / ({wacc}% - {g}%) = {fcf:g} / {(wacc - g) / 100:g} = {_m(tv)}.\n"
        "Sanity check: growth must be below the discount rate and roughly at or below long-run GDP growth.",
        [tv],
    )


def capm(r: random.Random) -> Problem:
    rf = r.choice([3, 4, 5])
    beta = r.choice([0.8, 1.0, 1.2, 1.5])
    erp = r.choice([5, 6])
    ke = rf + beta * erp
    return Problem(
        f"The risk-free rate is {rf}%, beta is {beta:g} and the equity risk premium is {erp}%. What is the cost of equity?",
        f"{ke:g}%",
        f"CAPM: cost of equity = risk-free rate + beta x equity risk premium = {rf}% + {beta:g} x {erp}% = {ke:g}%.",
        [ke],
    )


def wacc(r: random.Random) -> Problem:
    we = r.choice([60, 70, 75, 80])
    ke = r.choice([10, 12])
    kd = r.choice([4, 8])
    w = we / 100 * ke + (100 - we) / 100 * kd * (1 - TAX / 100)
    return Problem(
        f"A company is {we}% equity and {100 - we}% debt. Cost of equity is {ke}%, pre-tax cost of debt is {kd}%, tax rate {TAX}%. What is the WACC?",
        f"{w:g}%",
        f"After-tax cost of debt = {kd}% x (1 - {TAX}%) = {kd * 0.75:g}%.\n"
        f"WACC = {we}% x {ke}% + {100 - we}% x {kd * 0.75:g}% = {we / 100 * ke:g}% + {(100 - we) / 100 * kd * 0.75:g}% = {w:g}%.",
        [w],
    )


def pv_one_year(r: random.Random) -> Problem:
    fv = r.choice([110, 220, 330, 550, 1100])
    return Problem(
        f"A company will be worth {_m(fv)} one year from now. At a 10% discount rate, what is it worth today? What happens to value if the discount rate rises?",
        f"{_m(fv / 1.1)}",
        f"PV = {fv:g} / 1.10 = {_m(fv / 1.1)}. A higher discount rate lowers present value, because future cash is worth less today.",
        [fv / 1.1],
    )


# ---------------- Diluted share count ----------------

def tsm(r: random.Random) -> Problem:
    basic = r.choice([50, 80, 100])
    price = r.choice([20, 40])
    strike = int(price * r.choice([0.25, 0.5]))
    opts = r.choice([4, 8, 12])
    proceeds = opts * strike
    bought = proceeds / price
    new = opts - bought
    diluted = basic + new
    return Problem(
        f"A company has {basic} million basic shares at ${price} per share. There are {opts} million options with a ${strike} strike. "
        "What is the diluted share count using the treasury stock method?",
        f"{diluted:g} million shares",
        f"The options are in the money (${strike} < ${price}), so they are exercised: +{opts} million shares.\n"
        f"Proceeds = {opts} x ${strike} = ${proceeds:g}M, used to buy back {proceeds:g} / {price} = {bought:g} million shares.\n"
        f"Net new shares = {opts} - {bought:g} = {new:g} million. Diluted shares = {basic} + {new:g} = {diluted:g} million.",
        [diluted],
    )


def tsm_two_tranches(r: random.Random) -> Problem:
    basic = r.choice([100, 200])
    price = r.choice([20, 40])
    itm_strike = price // 2
    otm_strike = price + r.choice([5, 10])
    a, b = r.choice([4, 6, 10]), r.choice([5, 8])
    conv = r.choice([0, 100])
    conv_price = price / 2 if conv else 0
    bought = a * itm_strike / price
    new = a - bought
    conv_shares = conv / conv_price if conv else 0
    diluted = basic + new + conv_shares
    conv_text = f" There is also ${conv}M of convertible bonds with a ${conv_price:g} conversion price." if conv else ""
    conv_sol = (f"\nThe convertible is in the money (${conv_price:g} < ${price}), so it converts into {conv} / {conv_price:g} = {conv_shares:g} million shares."
                if conv else "")
    return Problem(
        f"Share price is ${price}, basic shares {basic} million. Options: {a} million at a ${itm_strike} strike and {b} million at a ${otm_strike} strike.{conv_text} "
        "What is the diluted share count?",
        f"{diluted:g} million shares",
        f"The ${otm_strike} options are out of the money, so ignore them.\n"
        f"The ${itm_strike} options: +{a} million shares, proceeds {a} x {itm_strike} = ${a * itm_strike}M buy back {bought:g} million, net +{new:g} million."
        f"{conv_sol}\nDiluted shares = {basic} + {new:g}" + (f" + {conv_shares:g}" if conv else "") + f" = {diluted:g} million.",
        [diluted],
    )


# ---------------- Merger math ----------------

def pe_rule(r: random.Random) -> Problem:
    acq = r.choice([10, 15, 20, 25])
    tgt = acq + r.choice([-5, 5, 10])
    acc = tgt < acq
    return Problem(
        f"An acquirer trading at {acq}x P/E buys a target in an all-stock deal at {tgt}x P/E (purchase price over target earnings). Accretive or dilutive, and why?",
        "Accretive" if acc else "Dilutive",
        f"In an all-stock deal, compare the acquirer's P/E (the cost of its stock is 1/{acq} = {100 / acq:.1f}% earnings yield) "
        f"with the P/E paid for the target (it 'yields' 1/{tgt} = {100 / tgt:.1f}%).\n"
        + ("The acquirer's P/E is higher, so it buys more earnings than it gives up: accretive." if acc
           else "The acquirer pays a higher P/E than its own, so it gives up more earnings than it buys: dilutive.")
        + " (Ignores synergies, fees and amortization of new intangibles.)",
        [],
    )


def stock_deal_eps(r: random.Random) -> Problem:
    shares = 100
    price = r.choice([20, 50])
    ni_a = r.choice([100, 200])
    purchase = r.choice([400, 500, 1000])
    ni_t = r.choice([20, 40, 50, 80])
    new_shares = purchase / price
    eps0 = ni_a / shares
    eps1 = (ni_a + ni_t) / (shares + new_shares)
    change = (eps1 / eps0 - 1) * 100
    return Problem(
        f"The acquirer has {_m(ni_a)} of net income, {shares} million shares at ${price}. It buys a target with {_m(ni_t)} of net income "
        f"for {_m(purchase)}, paid entirely in new stock. No synergies. What is pro forma EPS, and is the deal accretive or dilutive?",
        f"${eps1:.2f} vs ${eps0:.2f} standalone: {'accretive' if eps1 > eps0 else 'dilutive' if eps1 < eps0 else 'neutral'} ({change:+.1f}%)",
        f"Standalone EPS = {ni_a:g} / {shares} = ${eps0:.2f}.\nNew shares = {purchase:g} / {price} = {new_shares:g} million.\n"
        f"Pro forma EPS = ({ni_a:g} + {ni_t:g}) / ({shares} + {new_shares:g}) = {ni_a + ni_t:g} / {shares + new_shares:g} = ${eps1:.2f}.\n"
        f"That is {change:+.1f}% vs standalone: {'accretive' if eps1 > eps0 else 'dilutive' if eps1 < eps0 else 'neutral'}.",
        [round(eps1, 2)],
    )


def debt_deal_eps(r: random.Random) -> Problem:
    shares = 100
    ni_a = r.choice([200, 400])
    purchase = r.choice([500, 1000])
    rate = r.choice([4, 6, 8])
    ni_t = r.choice([20, 40, 60])
    after_tax_interest = purchase * rate / 100 * (1 - TAX / 100)
    eps0 = ni_a / shares
    eps1 = (ni_a + ni_t - after_tax_interest) / shares
    acc = "accretive" if eps1 > eps0 else "dilutive" if eps1 < eps0 else "neutral"
    return Problem(
        f"The acquirer has {_m(ni_a)} of net income and {shares} million shares. It buys a target with {_m(ni_t)} of net income for {_m(purchase)}, "
        f"funded entirely with new debt at {rate}% (tax rate {TAX}%). What is pro forma EPS?",
        f"${eps1:.2f} vs ${eps0:.2f} standalone: {acc}",
        f"After-tax interest = {purchase:g} x {rate}% x (1 - {TAX}%) = {_m(after_tax_interest)}.\n"
        f"Pro forma net income = {ni_a:g} + {ni_t:g} - {after_tax_interest:g} = {_m(ni_a + ni_t - after_tax_interest)}; no new shares.\n"
        f"Pro forma EPS = {ni_a + ni_t - after_tax_interest:g} / {shares} = ${eps1:.2f} vs ${eps0:.2f}: {acc}.\n"
        f"Shortcut: compare the target's earnings yield ({ni_t / purchase * 100:g}%) with the after-tax cost of debt ({rate * 0.75:g}%).",
        [round(eps1, 2)],
    )


def goodwill(r: random.Random) -> Problem:
    price = r.choice([500, 800, 1000])
    bv = r.choice([200, 300, 400])
    writeup = r.choice([0, 100])
    dtl = writeup * TAX / 100
    gw = price - bv - writeup + dtl
    wu_text = f" and writes up the target's assets by {_m(writeup)}" if writeup else ""
    return Problem(
        f"An acquirer pays {_m(price)} for a target with {_m(bv)} of book value (shareholders' equity){wu_text}. Tax rate {TAX}%. How much goodwill is created?",
        f"{_m(gw)}",
        (f"Goodwill = purchase price - book value - asset write-ups + new deferred tax liability.\n"
         f"The write-up creates a deferred tax liability of {writeup:g} x {TAX}% = {_m(dtl)}.\n"
         f"Goodwill = {price:g} - {bv:g} - {writeup:g} + {dtl:g} = {_m(gw)}." if writeup else
         f"Goodwill = purchase price - book value of the net assets = {price:g} - {bv:g} = {_m(gw)}."),
        [gw],
    )


# ---------------- LBO ----------------

def lbo_moic(r: random.Random) -> Problem:
    ebitda = 100
    combos = [(m, d, e, p) for m in (8, 10) for d in (50, 60) for e in (150, 200) for p in (100, 200, 300)
              if ((e * m - (ebitda * m * d / 100 - p)) / (ebitda * m * (1 - d / 100))) in (2, 2.5, 3)]
    mult, debt_pct, exit_ebitda, paydown = r.choice(combos)
    price = ebitda * mult
    debt = price * debt_pct / 100
    equity = price - debt
    exit_ev = exit_ebitda * mult
    exit_eq = exit_ev - (debt - paydown)
    moic = exit_eq / equity
    irr = {2: "about 15%", 3: "about 25%", 2.5: "about 20%"}.get(round(moic * 2) / 2, "use the 5-year rules: 2x is about 15%, 2.5x about 20%, 3x about 25%")
    return Problem(
        f"A sponsor buys a company with {_m(ebitda)} of EBITDA at {mult}x, using {debt_pct}% debt. Over 5 years EBITDA grows to {_m(exit_ebitda)} "
        f"and {_m(paydown)} of debt is paid down. It exits at the same {mult}x. What is the multiple of money, and roughly the IRR?",
        f"{moic:.1f}x MOIC, IRR {irr}",
        f"Purchase price = {mult} x {ebitda} = {_m(price)}; debt {_m(debt)}, sponsor equity {_m(equity)}.\n"
        f"Exit EV = {mult} x {exit_ebitda} = {_m(exit_ev)}; remaining debt = {debt:g} - {paydown} = {_m(debt - paydown)}; exit equity = {_m(exit_eq)}.\n"
        f"MOIC = {exit_eq:g} / {equity:g} = {moic:.1f}x over 5 years, so IRR is {irr}.",
        [round(moic, 1)],
    )


@dataclass
class Template:
    name: str
    topic: str
    difficulty: str  # easy | medium | hard
    make: Callable[[random.Random], Problem]


TEMPLATES = [
    Template("depreciation_up", "Accounting", "easy", depreciation_up),
    Template("buy_ppe_debt", "Accounting", "easy", buy_ppe_debt),
    Template("sell_inventory", "Accounting", "medium", sell_inventory),
    Template("inventory_writedown", "Accounting", "medium", inventory_writedown),
    Template("debt_interest", "Accounting", "medium", debt_interest),
    Template("sbc", "Accounting", "hard", sbc),
    Template("ev_bridge", "Enterprise & Equity Value", "easy", ev_bridge),
    Template("ev_change", "Enterprise & Equity Value", "medium", ev_change),
    Template("ev_or_equity_multiple", "Valuation", "easy", ev_or_equity_multiple),
    Template("implied_price_pe", "Valuation", "easy", implied_price_pe),
    Template("implied_price_ev_ebitda", "Valuation", "medium", implied_price_ev_ebitda),
    Template("capm", "DCF", "easy", capm),
    Template("pv_one_year", "DCF", "easy", pv_one_year),
    Template("ufcf", "DCF", "medium", ufcf),
    Template("gordon_tv", "DCF", "medium", gordon_tv),
    Template("wacc", "DCF", "hard", wacc),
    Template("tsm", "Diluted Share Count", "medium", tsm),
    Template("tsm_two_tranches", "Diluted Share Count", "hard", tsm_two_tranches),
    Template("pe_rule", "Merger Math", "easy", pe_rule),
    Template("goodwill", "Merger Math", "medium", goodwill),
    Template("stock_deal_eps", "Merger Math", "hard", stock_deal_eps),
    Template("debt_deal_eps", "Merger Math", "hard", debt_deal_eps),
    Template("lbo_moic", "LBO", "hard", lbo_moic),
]
BY_NAME = {t.name: t for t in TEMPLATES}


def build(name: str, seed: int) -> tuple[Template, Problem]:
    t = BY_NAME[name]
    return t, t.make(random.Random(seed))


# ---------------- Standard questions every account gets ----------------
# Common interview questions written for this app, so accounts without a school question bank still have
# behavioral, deal and market practice. (category, question)
CORE = [
    ("Behavioral", "Walk me through your resume."),
    ("Behavioral", "Why investment banking?"),
    ("Behavioral", "Why our bank, rather than our competitors?"),
    ("Behavioral", "Why this group? What draws you to the industry?"),
    ("Behavioral", "Tell me about a time you worked on a team that was struggling. What did you do?"),
    ("Behavioral", "Tell me about a time you made a mistake. How did you handle it?"),
    ("Behavioral", "Tell me about a time you had to deliver under a tight deadline."),
    ("Behavioral", "Tell me about a time you disagreed with a manager or teammate."),
    ("Behavioral", "Tell me about a time you led a group without formal authority."),
    ("Behavioral", "What is your greatest strength, and what is a weakness you are working on?"),
    ("Behavioral", "Banking hours are demanding. How do you know you are ready for them?"),
    ("Behavioral", "Where do you see yourself in five years?"),
    ("Behavioral", "What would your previous manager say you could do better?"),
    ("Behavioral", "Who else have you spoken with at the firm, and what did you learn from them?"),
    ("Behavioral", "What is something on your resume you are most proud of?"),
    ("Behavioral", "What do you do outside of work and school?"),
    ("Behavioral", "Do you have any questions for me?"),
    ("Deal", "Tell me about a deal you have been following."),
    ("Deal", "Walk me through a recent M&A deal in the industry you want to cover. Was it a good deal for the buyer?"),
    ("Deal", "Pick a recent deal. What premium was paid, and was it justified?"),
    ("Deal", "Tell me about a recent IPO or debt offering. How did the market receive it?"),
    ("Deal", "If you were advising a company in your target industry, who would you tell them to buy, and why?"),
    ("Markets", "Where do you think interest rates are heading, and how does that affect M&A activity?"),
    ("Markets", "What is a trend in your target industry that bankers should be paying attention to?"),
    ("Markets", "How has the M&A and IPO market looked over the past year?"),
    ("Markets", "Pitch me a stock: would you buy or sell it, and why?"),
    ("Markets", "Where is the S&P 500 today, and what is the 10-year Treasury yield?"),
]
