"""Website domain per bank, used only to show each bank's logo in the map."""

DOMAINS = {
    "Bank of America": "bankofamerica.com",
    "Barclays": "barclays.com",
    "Centerview": "centerviewpartners.com",
    "Citi": "citi.com",
    "Evercore": "evercore.com",
    "Goldman Sachs": "goldmansachs.com",
    "Greenhill": "greenhill.com",
    "Guggenheim": "guggenheimpartners.com",
    "Harris Williams": "harriswilliams.com",
    "Houlihan Lokey": "hl.com",
    "J.P. Morgan": "jpmorgan.com",
    "Jefferies": "jefferies.com",
    "Lazard": "lazard.com",
    "Moelis": "moelis.com",
    "Morgan Stanley": "morganstanley.com",
    "PJT": "pjtpartners.com",
    "PWP": "pwpartners.com",
    "Piper Sandler": "pipersandler.com",
    "RBC": "rbccm.com",
    "Rothschild": "rothschildandco.com",
    "Wells Fargo": "wellsfargo.com",
    "Qatalyst": "qatalyst.com",
    "Allen & Company": "",
    "LionTree": "liontree.com",
    "Ducera": "ducera.com",
    "Gordon Dyal & Co.": "gordondyal.com",
    "UBS": "ubs.com",
    "Macquarie": "macquarie.com",
    "William Blair": "williamblair.com",
    "BMO": "bmo.com",
    "Raymond James": "raymondjames.com",
    "Deutsche Bank": "db.com",
    "Cain Brothers": "",
    "Baird": "rwbaird.com",
    "TD Cowen": "tdsecurities.com",
    "Solomon Partners": "solomonpartners.com",
    "KBW": "kbw.com",
    "Oppenheimer": "oppenheimer.com",
    "Nomura": "nomura.com",
    "BNP Paribas": "bnpparibas.com",
    "Lincoln International": "lincolninternational.com",
    "KeyBanc": "key.com",
    "Mizuho": "mizuhogroup.com",
    "HSBC": "hsbc.com",
    "MUFG": "mufgamericas.com",
    "Stifel": "stifel.com",
    "Cantor Fitzgerald": "cantor.com",
    "BGL": "bglco.com",
}


# New York office addresses for cover letters (public information). Users can override one per bank.
ADDRESSES = {
    "Bank of America": "One Bryant Park\nNew York, NY 10036",
    "Barclays": "745 Seventh Avenue\nNew York, NY 10020",
    "Centerview": "31 West 52nd Street\nNew York, NY 10019",
    "Citi": "388 Greenwich Street\nNew York, NY 10013",
    "Evercore": "55 East 52nd Street\nNew York, NY 10055",
    "Goldman Sachs": "200 West Street\nNew York, NY 10282",
    "Guggenheim": "330 Madison Avenue\nNew York, NY 10017",
    "Houlihan Lokey": "245 Park Avenue\nNew York, NY 10167",
    "J.P. Morgan": "270 Park Avenue\nNew York, NY 10017",
    "Lazard": "30 Rockefeller Plaza\nNew York, NY 10112",
    "Morgan Stanley": "1585 Broadway\nNew York, NY 10036",
    "RBC": "200 Vesey Street\nNew York, NY 10281",
}


# Formal firm names for the cover letter's recipient block (from letters the student has sent).
LETTER_NAMES = {"Guggenheim": "Guggenheim Securities, LLC"}


def domain(bank: str) -> str:
    return DOMAINS.get(bank, "")
