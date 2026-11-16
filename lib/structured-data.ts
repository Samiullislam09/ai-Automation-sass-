import { BRAND, SITE_URL } from "@/lib/brand";
import { PLANS } from "@/lib/plans";
import { CATS } from "@/components/landing-v2/faq-data";

/** schema.org JSON-LD for the home page: who we are (Organization), what the product is and what it costs (SoftwareApplication, with the REAL
 *  plan prices from lib/store.tsx), and the FAQ the page shows (FAQPage). Search engines use it for rich results. */
export function homeStructuredData() {
  const faq = Object.values(CATS).flat();
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: BRAND.name,
      url: SITE_URL,
      logo: `${SITE_URL}/brand/mencra-mark.svg`,
      email: BRAND.supportEmail,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: BRAND.name,
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "An AI marketing team for small business: keyword research, articles in your voice and publishing to your website, with your approval at every step.",
      offers: Object.values(PLANS).map((p) => ({ "@type": "Offer", name: p.name, price: String(p.price), priceCurrency: "USD" })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
}
