import "./landing.css";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { Integrations } from "./Integrations";
import { Workflow } from "./Workflow";
import { Pricing } from "./Pricing";
import { Plans } from "./Plans";
import { StickyCta } from "./StickyCta";
import { Features } from "./Features";
import { Faq } from "./Faq";
import { Closing } from "./Closing";
import { Footer } from "./Footer";

/** Home page: light, mint-and-green marketing layout. Brand name comes from lib/brand.ts. */
export default function Landing() {
  return (
    <div className="lv2">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@300..800&display=swap" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-[#0a0a0a] focus:shadow-lg">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />
        <Integrations />
        <Workflow />
        <Pricing />
        <Plans />
        <Features />
        <Faq />
        <Closing />
      </main>
      <Footer />
      <StickyCta />
    </div>
  );
}
