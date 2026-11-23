"""Run: pytest test_listing.py -q"""
from listing import clean_name, client_page_links, companies_from_html, next_page_url

DIR = "https://members.example-assoc.org/list?page=1"


def test_directory_card_with_visit_website_is_named_from_its_heading():
    html = """
    <div class="card"><h3>Gulf Steel Works</h3><a href="https://www.gulfsteel.ae/about">Visit website</a></div>
    <div class="card"><h3>Al Noor Foods</h3><a href="https://alnoorfoods.com">Visit website</a></div>
    """
    out = companies_from_html(html, DIR)
    assert [(c["name"], c["domain"], c["website"]) for c in out] == [
        ("Gulf Steel Works", "gulfsteel.ae", "https://www.gulfsteel.ae"),
        ("Al Noor Foods", "alnoorfoods.com", "https://alnoorfoods.com"),
    ]


def test_link_text_that_names_the_company_is_used_directly():
    out = companies_from_html('<ul><li><a href="https://acme.ae">Acme Industries</a></li></ul>', DIR)
    assert out[0]["name"] == "Acme Industries"


def test_own_site_social_and_junk_links_are_not_companies():
    html = """
    <a href="/about">About</a>
    <a href="https://members.example-assoc.org/join">Join</a>
    <a href="https://facebook.com/x">FB</a>
    <a href="https://www.linkedin.com/company/y">LI</a>
    <a href="https://wa.me/971500000000">WA</a>
    <a href="mailto:a@b.com">mail</a>
    <a href="https://acme.ae/brochure.pdf">PDF</a>
    """
    assert companies_from_html(html, DIR) == []


def test_directory_redirect_link_is_unwrapped_to_the_company():
    html = '<h3>Delta Pack</h3><a href="/out?url=https%3A%2F%2Fdeltapack.com">Website</a>'
    out = companies_from_html(html, DIR)
    assert out and out[0]["domain"] == "deltapack.com"
    assert out[0]["name"] == "Delta Pack"


def test_same_company_linked_twice_is_one_row():
    html = '<a href="https://acme.ae">Acme</a><a href="https://www.acme.ae/contact">Acme again</a>'
    assert len(companies_from_html(html, DIR)) == 1


def test_a_heading_shared_by_many_cards_does_not_name_the_company():
    # Two headings in the shared container: the climb must stop, so the name falls back to the host
    # rather than borrowing a neighbour's heading.
    html = '<div><h3>One</h3><h3>Two</h3><a href="https://zeta-trading.com">Website</a></div>'
    out = companies_from_html(html, DIR)
    assert out[0]["name"] == "Zeta Trading"


def test_clients_mode_reads_logo_alts_with_no_link_but_directory_mode_does_not():
    html = """
    <img src="a.png" alt="Emirates Steel logo"><img src="b.png" alt="banner image">
    <a href="https://partner.ae"><img src="c.png" alt="Partner Co"></a>
    """
    clients = companies_from_html(html, "https://rival.com/clients", mode="clients")
    names = {c["name"] for c in clients}
    assert names == {"Emirates Steel", "Partner Co"}
    assert next(c for c in clients if c["name"] == "Emirates Steel")["website"] is None
    directory = companies_from_html(html, "https://rival.com/clients", mode="directory")
    assert {c["name"] for c in directory} == {"Partner Co"}


def test_limit_is_respected():
    html = "".join(f'<a href="https://co{i}.com">Company {i}</a>' for i in range(10))
    assert len(companies_from_html(html, DIR, limit=4)) == 4


def test_clean_name_rejects_generic_and_sentences():
    assert clean_name("Visit website") is None
    assert clean_name("https://acme.com") is None
    assert clean_name("ok") == "ok"
    assert clean_name("We are a leading provider of many different kinds of things worldwide") is None
    assert clean_name("Acme Steel | Dubai") == "Acme Steel"
    assert clean_name("Acme Steel logo") == "Acme Steel"


def test_client_page_links_prefers_clients_over_projects_and_stays_on_site():
    html = """
    <a href="/projects">Projects</a><a href="/our-clients">Our Clients</a>
    <a href="/case-studies/abc">Case study</a><a href="https://other.com/clients">elsewhere</a>
    <a href="/pricing">Pricing</a>
    """
    out = client_page_links(html, "https://rival.com/")
    assert out[0] == "https://rival.com/our-clients"
    assert "https://rival.com/pricing" not in out
    assert all(u.startswith("https://rival.com/") for u in out)


def test_next_page_url_rel_next_and_text_next():
    assert next_page_url('<link rel="next" href="?page=2">', DIR) == "https://members.example-assoc.org/list?page=2"
    assert next_page_url('<a href="/list?page=3">Next</a>', DIR) == "https://members.example-assoc.org/list?page=3"
    assert next_page_url('<a href="https://elsewhere.com/p2">Next</a>', DIR) is None
    assert next_page_url("<p>nothing</p>", DIR) is None
