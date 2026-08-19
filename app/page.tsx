import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { TrustStrip } from "@/components/landing/trust-strip";
import { OfficeSection } from "@/components/landing/office-section";
import { Features } from "@/components/landing/features";
import { Comparison } from "@/components/landing/comparison";
import { Pricing } from "@/components/landing/pricing";
import { FAQ } from "@/components/landing/faq";
import { FinalCTA } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { faq } from "@/lib/landing-content";

export default function Landing() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "GrowthTeam AI",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description: "AI marketing team for small businesses — articles, social, leads, SEO, human-approved.",
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };

  return (
    <SmoothScroll>
      <main className="theme-scope relative bg-background text-foreground min-h-screen">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <div className="noise-overlay" aria-hidden="true" />
        <Navbar />
        <Hero />
        <TrustStrip />
        <OfficeSection />
        <Features />
        <Comparison />
        <Pricing />
        <FAQ />
        <FinalCTA />
        <Footer />
      </main>
    </SmoothScroll>
  );
}
