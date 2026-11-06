"""Run: pytest test_extract.py -q"""
from extract import business_emails, company_name, phone_numbers, whatsapp_number


def test_business_emails_drops_personal_and_hr_and_images_keeps_business():
    text = "Reach us: sales@acme.ae or owner@gmail.com or hr@acme.ae. logo@2x.png is not a mailbox."
    assert business_emails(text, "acme.ae") == ["sales@acme.ae"]


def test_business_emails_prefers_own_domain_and_sales_sounding_name():
    text = "info@thirdparty.com and office@acme.ae and info@acme.ae"
    out = business_emails(text, "acme.ae")
    assert out[0] == "info@acme.ae"
    assert "office@acme.ae" in out


def test_business_emails_empty_when_only_personal():
    assert business_emails("contact me at jane@yahoo.com", "acme.ae") == []


def test_whatsapp_number_only_from_a_real_wa_link():
    html = '<a href="https://wa.me/971501234567">Chat</a>'
    assert whatsapp_number(html) == "+971501234567"


def test_whatsapp_number_from_api_whatsapp_com_param():
    html = '<a href="https://api.whatsapp.com/send?phone=971501234567&text=hi">WhatsApp</a>'
    assert whatsapp_number(html) == "+971501234567"


def test_whatsapp_number_none_when_no_link():
    assert whatsapp_number("<p>Call us on +971 50 123 4567</p>") is None


def test_phone_numbers_valid_only_in_e164():
    text = "Call +971 4 282 1000 or our mobile 050-123-4567, or our fax 123 (not a number)."
    nums = phone_numbers(text, "AE")
    assert "+97142821000" in nums
    assert all(n.startswith("+") for n in nums)


def test_phone_numbers_rejects_garbage():
    assert phone_numbers("our ref is 2026-11-06, page 4 of 12", "AE") == []


def test_company_name_prefers_json_ld_then_og_then_title_then_domain():
    assert company_name("Home", None, "Acme Safety Consultants", "acmesafety.ae") == "Acme Safety Consultants"
    assert company_name("Home", "Acme Safety", None, "acmesafety.ae") == "Acme Safety"
    assert company_name("Acme Safety Consultants | ISO 45001 in Dubai", None, None, "acmesafety.ae") == "Acme Safety Consultants"
    assert company_name("About Us", None, None, "assent-steel.com") == "Assent Steel"
    assert company_name("Contact RMC Consultancy", None, None, "rmcconsultancy.ae") == "RMC Consultancy"


def test_company_name_never_blank():
    assert company_name("", None, None, "www.madar-uae.com") == "Madar Uae"


def test_company_name_strips_only_the_literal_www_prefix():
    # Regression: str.lstrip("www.") strips a CHARACTER SET, not a prefix, and ate real letters
    # off this exact host in production ("wca-global.com" -> "ca-global.com").
    assert company_name("", None, None, "www.wca-global.com") == "Wca Global"
