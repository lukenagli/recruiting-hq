"""Standard investment banking technical questions with model answers, for every account.

Written for this app from general finance knowledge: these are the concept questions bankers commonly ask, with
original model answers. (Paid guides some users own are kept in their private answer library instead.)
Each entry: (topic, difficulty, question, model answer). Topics match practice.TOPICS.
"""

ACC, EV, VAL, DCF, MA, DIL, LBO = ("Accounting", "Enterprise & Equity Value", "Valuation", "DCF", "Merger Math",
                                   "Diluted Share Count", "LBO")

QUESTIONS = [
    # ---------------- Accounting ----------------
    (ACC, "easy", "Walk me through the three financial statements.",
     "The income statement shows revenue, expenses and net income over a period. The balance sheet shows assets, "
     "liabilities and equity at a point in time, and assets must equal liabilities plus equity. The cash flow statement "
     "starts with net income, adjusts for non-cash items and changes in working capital (operating), then adds investing "
     "and financing cash flows to get the net change in cash."),
    (ACC, "easy", "How do the three financial statements link together?",
     "Net income from the income statement is the first line of the cash flow statement and flows into retained earnings "
     "on the balance sheet. The cash flow statement adjusts net income for non-cash items such as D&A and for changes in "
     "balance sheet items like working capital, capex and debt, and its net change in cash updates the cash balance on the "
     "balance sheet."),
    (ACC, "easy", "If you could only look at one financial statement to judge a company's health, which would you pick and why?",
     "The cash flow statement, because it shows how much cash the business actually generates and uses, which is harder "
     "to dress up with accounting choices than net income. A common alternative answer is the balance sheet plus cash "
     "flow statement together, since with those you can rebuild most of the income statement."),
    (ACC, "easy", "What is working capital, and what does an increase in working capital mean for cash flow?",
     "Working capital is current operating assets (like receivables and inventory) minus current operating liabilities "
     "(like payables and accrued expenses). An increase means more cash is tied up in operations, so it reduces cash flow; "
     "a decrease frees up cash."),
    (ACC, "medium", "Can a company have positive net income and still go bankrupt?",
     "Yes. Net income is an accounting figure, not cash. A company can book profitable sales it has not collected, tie up "
     "cash in inventory, or face large debt maturities it cannot refinance. If it runs out of cash to pay obligations as "
     "they come due, it can fail despite reporting profits."),
    (ACC, "medium", "Why do we add back depreciation on the cash flow statement?",
     "Depreciation is a non-cash expense: it reduces net income, but no cash leaves the business that period because the "
     "cash was spent when the asset was bought (as capex). So the cash flow statement adds it back to net income to get "
     "to actual cash generated."),
    (ACC, "medium", "What is the difference between capitalizing and expensing a cost?",
     "Expensing puts the full cost on the income statement right away. Capitalizing records it as an asset on the balance "
     "sheet and spreads the cost over its useful life through depreciation or amortization. Costs that benefit many years, "
     "like equipment, are capitalized; costs that benefit only the current period, like salaries, are expensed."),
    (ACC, "medium", "What is deferred revenue, and how does it affect the statements when a customer prepays?",
     "Deferred revenue is cash received for goods or services not yet delivered, recorded as a liability. When the customer "
     "prepays, cash rises and deferred revenue rises on the balance sheet, with no revenue yet on the income statement. "
     "As the company delivers, it moves the amount from deferred revenue into revenue."),
    (ACC, "medium", "What are deferred tax assets and liabilities?",
     "They arise when book (financial reporting) income and tax income differ in timing. A deferred tax liability means "
     "the company will pay more tax in the future, often from faster depreciation for taxes than for books. A deferred tax "
     "asset means it will pay less in the future, for example from net operating losses it can use against later profits."),
    (ACC, "hard", "Walk me through the statements if a company buys $100 of inventory with cash, then sells it for $150.",
     "Buying it just swaps cash for inventory on the balance sheet, with no income statement effect. When it sells for $150: "
     "revenue $150, COGS $100, pre-tax income $50; at a 25% tax rate, net income rises $37.50. On the cash flow statement, "
     "net income is up $37.50 and the $100 decrease in inventory adds cash, so cash from the sale is up $137.50 (net of "
     "the original $100 purchase, cash is up $37.50 overall). Retained earnings rise $37.50 and the balance sheet balances."),
    (ACC, "hard", "What happens on the statements when a company issues $100 of debt and uses it to buy a $100 machine?",
     "Nothing on the income statement at first. On the cash flow statement, capex of $100 is an investing outflow and the "
     "$100 of debt raised is a financing inflow, so cash is unchanged. On the balance sheet, PP&E rises $100 and debt "
     "rises $100. Later periods show depreciation and interest expense, both of which lower net income."),
    (ACC, "hard", "A company records a $50 goodwill impairment. Walk me through the statements.",
     "On the income statement, a $50 non-cash expense lowers pre-tax income. Goodwill impairments are often not tax "
     "deductible, so net income typically falls the full $50. On the cash flow statement, net income is down $50 and the "
     "impairment is added back, so cash is unchanged. On the balance sheet, goodwill falls $50 and retained earnings fall $50."),
    (ACC, "medium", "What is the difference between operating and finance leases?",
     "Both now put a right-of-use asset and a lease liability on the balance sheet. Under US GAAP, an operating lease shows "
     "one straight-line lease expense on the income statement, while a finance lease splits it into amortization of the "
     "asset and interest on the liability, much like owning the asset with debt."),

    # ---------------- Enterprise and equity value ----------------
    (EV, "easy", "What is the difference between enterprise value and equity value?",
     "Equity value is the value of the company's shares, belonging only to common shareholders. Enterprise value is the "
     "value of the core business to all capital providers: equity value plus debt, preferred stock and noncontrolling "
     "interests, minus cash and other non-operating assets."),
    (EV, "easy", "Why do you subtract cash when calculating enterprise value?",
     "Enterprise value measures the core operating business. Cash is a non-operating asset; a buyer of the business could "
     "use it to pay down the purchase price, so it reduces the net cost of acquiring the operations."),
    (EV, "medium", "Why do you add noncontrolling interest to enterprise value?",
     "When a company owns more than 50% of a subsidiary, it consolidates 100% of that subsidiary's revenue and EBITDA. To "
     "keep the numerator consistent with those consolidated metrics, you add the value of the part it does not own, the "
     "noncontrolling interest."),
    (EV, "medium", "Can a company have a negative enterprise value? What would that mean?",
     "Yes, if its cash is larger than its equity value plus debt. It usually means the market expects the business to burn "
     "cash or lose value, or it is distressed, so investors value the operations below zero."),
    (EV, "medium", "A company raises $100 of new equity and holds the cash. What happens to equity value and enterprise value?",
     "Equity value rises $100 because there are new shares worth $100. Cash also rises $100, which is subtracted, so "
     "enterprise value does not change. Financing transactions change equity value but not the value of the operations."),
    (EV, "hard", "Which metrics pair with enterprise value and which with equity value in multiples?",
     "Match the numerator to who the metric belongs to. Metrics before interest belong to all capital providers and pair "
     "with enterprise value: revenue, EBITDA, EBIT, unlevered free cash flow. Metrics after interest belong to equity "
     "holders and pair with equity value: net income (P/E), levered free cash flow, book value of equity."),

    # ---------------- Valuation ----------------
    (VAL, "easy", "What are the main ways to value a company?",
     "Comparable public companies (trading multiples), precedent transactions (multiples paid in past acquisitions), and a "
     "discounted cash flow analysis. Others include an LBO analysis (what a sponsor could pay) and sum-of-the-parts."),
    (VAL, "easy", "Which valuation method usually gives the highest value, and why?",
     "Precedent transactions, usually, because buyers pay a control premium and price in synergies. A DCF can be highest or "
     "lowest depending on assumptions; trading comps reflect minority stakes without a premium."),
    (VAL, "medium", "How do you choose comparable companies?",
     "Start with the same industry and business model, then narrow by size (revenue, market cap), growth, margins and "
     "geography. The goal is companies whose risk and growth make their multiples a fair benchmark."),
    (VAL, "medium", "Why is EV/EBITDA used more than P/E?",
     "EV/EBITDA is not affected by capital structure, because EBITDA is before interest, and it is less affected by "
     "differences in depreciation policy and taxes. P/E is distorted by leverage, one-time items and non-cash charges, and "
     "is meaningless when earnings are negative."),
    (VAL, "medium", "When would you not use a DCF?",
     "When cash flows are very hard to predict, such as early-stage or highly cyclical companies, and for banks and "
     "insurers, where debt is part of operations and free cash flow is not meaningful. Those are valued with multiples or "
     "dividend and book value based methods."),
    (VAL, "hard", "How would you value a company with negative earnings?",
     "Use multiples of metrics that are positive, such as EV/revenue or EV/gross profit, or industry operating metrics "
     "like users or subscribers. A DCF can still work if the company is expected to become profitable, with a longer "
     "projection period until cash flows stabilize."),

    # ---------------- DCF ----------------
    (DCF, "easy", "Walk me through a DCF.",
     "Project the company's unlevered free cash flow for about five to ten years. Estimate a terminal value for the years "
     "after that, using a perpetuity growth rate or an exit multiple. Discount the cash flows and terminal value to today "
     "at the WACC, and add them to get enterprise value. Subtract net debt to get equity value, then divide by diluted "
     "shares for a value per share."),
    (DCF, "easy", "How do you calculate unlevered free cash flow?",
     "Start with EBIT, subtract taxes on EBIT to get NOPAT, add back non-cash charges such as D&A, subtract capital "
     "expenditures, and subtract the increase in net working capital."),
    (DCF, "easy", "What is WACC and how do you calculate it?",
     "The weighted average cost of capital is the blended return required by all capital providers. WACC = cost of equity "
     "x equity weight + after-tax cost of debt x debt weight (+ cost of preferred x preferred weight), using market values "
     "for the weights. Debt is after tax because interest is deductible."),
    (DCF, "easy", "How do you calculate the cost of equity?",
     "Usually with CAPM: cost of equity = risk-free rate + beta x equity risk premium. Beta measures how much the stock "
     "moves relative to the market."),
    (DCF, "medium", "What are the two ways to calculate terminal value?",
     "The perpetuity growth method: final-year free cash flow x (1 + g) / (WACC - g), assuming cash flows grow at a "
     "constant rate forever. The exit multiple method: final-year EBITDA (or another metric) x a multiple taken from "
     "comparable companies or deals."),
    (DCF, "medium", "How do you unlever and relever beta, and why?",
     "Comparable companies' betas include the effect of their debt. Unlever each: unlevered beta = levered beta / (1 + (1 - "
     "tax rate) x debt/equity). Take the median, then relever at your company's target capital structure with the same "
     "formula reversed. This isolates business risk from financing risk."),
    (DCF, "medium", "What happens to a DCF value if the discount rate goes up?",
     "Value goes down, because future cash flows are worth less today. The terminal value is especially sensitive, since "
     "it is far in the future and often most of the total value."),
    (DCF, "hard", "Would you rather have a 10% higher discount rate or 10% lower revenue in a DCF?",
     "It depends on the company, but a higher discount rate usually hurts more, because it lowers the value of every cash "
     "flow and the terminal value, which compound over time. Lower revenue's effect depends on margins and how much of the "
     "cost base is fixed."),
    (DCF, "hard", "Why do you use the mid-year convention?",
     "Cash flows arrive throughout the year, not all at year end. Discounting each year's cash flow by half a year less "
     "(0.5, 1.5, 2.5 ...) reflects that and gives a slightly higher, more realistic value."),
    (DCF, "hard", "What is a levered DCF and how does it differ from an unlevered DCF?",
     "A levered DCF uses levered free cash flow (after interest and debt repayments), discounts at the cost of equity, and "
     "produces equity value directly. An unlevered DCF uses cash flow before interest, discounts at WACC, and produces "
     "enterprise value. Bankers use the unlevered version far more."),

    # ---------------- Merger math ----------------
    (MA, "easy", "Walk me through a merger model.",
     "Project the buyer's and seller's financials, decide the purchase price and how it is paid (cash, debt, stock), "
     "combine the income statements, adjusting for lost interest on cash used, new interest on debt, synergies and new "
     "D&A from asset write-ups, and divide combined net income by the new share count. Compare that pro forma EPS with the "
     "buyer's standalone EPS to see if the deal is accretive or dilutive."),
    (MA, "easy", "What does accretive and dilutive mean?",
     "A deal is accretive if the buyer's pro forma earnings per share are higher than its standalone EPS, and dilutive if "
     "they are lower. It measures the deal's near-term effect on per-share earnings, not whether it creates value."),
    (MA, "medium", "How can you quickly tell if an all-stock deal is accretive or dilutive?",
     "Compare price-to-earnings ratios. If the buyer's P/E is higher than the P/E it pays for the seller, it is accretive, "
     "because it uses expensive stock to buy cheaper earnings. If the buyer's P/E is lower, it is dilutive."),
    (MA, "medium", "What is the cheapest way to fund an acquisition, and why?",
     "Usually cash on hand, because the only cost is the interest it would have earned, which is low. Debt is next, since "
     "interest is tax deductible. Stock is usually the most expensive, because its cost is the buyer's earnings yield "
     "(E/P) and it gives up ownership."),
    (MA, "medium", "Why would a company pay for an acquisition with stock instead of cash?",
     "When it lacks cash or debt capacity, when its stock is highly valued (a high P/E makes stock cheap currency), when the "
     "seller wants to share in future upside, or to keep leverage low. Stock deals also defer taxes for the seller in "
     "some structures."),
    (MA, "medium", "What are synergies, and which kind do bankers trust more?",
     "Synergies are the extra value from combining two companies. Cost synergies come from cutting overlapping expenses; "
     "revenue synergies come from selling more together. Cost synergies are more trusted because they are within "
     "management's control; revenue synergies depend on customers."),
    (MA, "hard", "How is goodwill created in an acquisition?",
     "The buyer pays a purchase price above the fair value of the seller's identifiable net assets. After writing assets "
     "up to fair value and recording new intangibles (and the deferred tax liability those write-ups create), the "
     "remaining excess of the purchase price is goodwill."),
    (MA, "hard", "Why might a deal be dilutive but still a good idea?",
     "EPS impact is short term. A deal can create long-term value through growth, strategic position, synergies that take "
     "time to realize, or a better business mix, even if near-term EPS falls. Accretion also ignores the cost of risk and "
     "of the capital used."),

    # ---------------- Diluted share count ----------------
    (DIL, "easy", "Why do you use diluted shares instead of basic shares?",
     "Because options, warrants, restricted stock and convertibles can turn into common shares, which would share in the "
     "company's value. Using diluted shares gives a more accurate value per share."),
    (DIL, "medium", "Walk me through the treasury stock method.",
     "For in-the-money options and warrants, assume they are exercised, adding new shares. Assume the company uses the "
     "exercise proceeds (options x strike price) to buy back shares at the current share price. The net new shares are "
     "the options exercised minus the shares repurchased; add that to basic shares."),
    (DIL, "medium", "How do you treat convertible bonds in the diluted share count?",
     "If the conversion price is below the current share price (in the money), assume conversion: add bond face value / "
     "conversion price in new shares, and remove the bond from debt so it is not double counted. If out of the money, "
     "keep it as debt."),
    (DIL, "hard", "Why is calculating diluted shares circular in a valuation?",
     "The number of in-the-money options depends on the share price, but the share price you are solving for depends on "
     "the diluted share count. Models resolve it by iterating until the price and share count are consistent."),

    # ---------------- LBO ----------------
    (LBO, "easy", "Walk me through a basic LBO.",
     "A private equity firm buys a company using a large amount of debt and some equity. It projects cash flows and uses "
     "them to pay down debt over about five years, then assumes an exit at some multiple of EBITDA. The returns (IRR and "
     "multiple of money) come from the exit equity value versus the equity it put in."),
    (LBO, "easy", "What makes a company a good LBO candidate?",
     "Stable, predictable cash flows to service debt, low capital needs, a strong market position, a solid management team, "
     "room for operational improvement, assets to support borrowing, and a realistic exit path."),
    (LBO, "medium", "Why does leverage increase returns in an LBO?",
     "Debt reduces the equity the sponsor has to put in. Any gain in the company's value goes entirely to equity after "
     "debt is repaid, so the same dollar gain is a larger percentage return on a smaller equity check. Debt paydown from "
     "cash flow also builds equity value."),
    (LBO, "medium", "What are the main drivers of returns in an LBO?",
     "EBITDA growth (operational improvement and revenue growth), multiple expansion (selling at a higher multiple than "
     "you bought at), and debt paydown from free cash flow. Lower purchase price and more leverage also lift returns."),
    (LBO, "medium", "Roughly what IRR does doubling your money in five years give? Tripling?",
     "Doubling in five years is about a 15% IRR; tripling is about 25%. Doubling in three years is about 26%."),
    (LBO, "hard", "Why might a private equity firm not want to use as much debt as possible?",
     "More debt raises the risk of default if results disappoint, adds covenants that limit flexibility, raises interest "
     "costs, and lenders may simply not provide it. The best structure balances higher returns against the chance of "
     "losing the equity."),
]
