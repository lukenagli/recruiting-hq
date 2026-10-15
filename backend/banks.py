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
}


def domain(bank: str) -> str:
    return DOMAINS.get(bank, "")
