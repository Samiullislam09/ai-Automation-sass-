import "./landing.css";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { ValueStrip } from "./ValueStrip";
import { Integrations } from "./Integrations";
import { Workflow } from "./Workflow";
import { Pricing } from "./Pricing";
import { Plans } from "./Plans";
import { Testimonials } from "./Testimonials";
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
      <Nav />
      <main>
        <Hero />
        <ValueStrip />
        <Integrations />
        <Workflow />
        <Pricing />
        <Plans />
        <Testimonials />
        <Features />
        <Faq />
        <Closing />
      </main>
      <Footer />
      <StickyCta />
    </div>
  );
}
