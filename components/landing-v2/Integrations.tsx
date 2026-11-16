import type { IconType } from "react-icons";
import {
  SiWordpress, SiGooglesearchconsole, SiGoogleanalytics, SiWhatsapp, SiShopify, SiWebflow,
  SiInstagram, SiFacebook, SiX, SiYoutube, SiMailchimp, SiZapier, SiNotion, SiHubspot,
} from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";

/** Full-colour brand marks, like the reference's model logos. `soon` items are on the roadmap. */
type Item = { name: string; Icon: IconType; color?: string; soon?: boolean };

const WORDPRESS: Item = { name: "WordPress", Icon: SiWordpress, color: "#21759B" };
const GSC: Item = { name: "Google Search Console", Icon: SiGooglesearchconsole, color: "#458CF5" };
const GA: Item = { name: "Google Analytics", Icon: SiGoogleanalytics, color: "#E37400" };
const WA: Item = { name: "WhatsApp", Icon: SiWhatsapp, color: "#25D366" };
const GOOGLE: Item = { name: "Google Sign-in", Icon: FcGoogle };
const SHOPIFY: Item = { name: "Shopify", Icon: SiShopify, color: "#7AB55C", soon: true };
const WEBFLOW: Item = { name: "Webflow", Icon: SiWebflow, color: "#146EF5", soon: true };
const IG: Item = { name: "Instagram", Icon: SiInstagram, color: "#E4405F", soon: true };
const LI: Item = { name: "LinkedIn", Icon: FaLinkedin, color: "#0A66C2", soon: true };
const FB: Item = { name: "Facebook", Icon: SiFacebook, color: "#1877F2", soon: true };
const X: Item = { name: "X", Icon: SiX, color: "#000000", soon: true };
const YT: Item = { name: "YouTube", Icon: SiYoutube, color: "#FF0000", soon: true };
const MC: Item = { name: "Mailchimp", Icon: SiMailchimp, color: "#F5B800", soon: true };
const ZP: Item = { name: "Zapier", Icon: SiZapier, color: "#FF4F00", soon: true };
const NO: Item = { name: "Notion", Icon: SiNotion, color: "#000000", soon: true };
const HS: Item = { name: "HubSpot", Icon: SiHubspot, color: "#FF7A59", soon: true };

/** Only integrations that work today are shown; the rest are named in one honest line below. */
const LIVE = [WORDPRESS, GSC, GA, WA, GOOGLE];

function Pill({ it }: { it: Item }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-3 rounded-full border border-[#ebebeb] bg-white px-7 text-[14px] font-medium leading-[1.5] shadow-sm md:text-[18px] max-[767px]:h-11 max-[600px]:gap-2 max-[600px]:px-4">
      <it.Icon className="h-6 w-6 shrink-0 max-[767px]:h-5 max-[767px]:w-5" style={it.color ? { color: it.color } : undefined} />
      <span className="whitespace-nowrap">{it.name}</span>
      {it.soon && <span className="rounded-full bg-[#f4f4f5] px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-[#525252]">Soon</span>}
    </div>
  );
}

export function Integrations() {
  return (
    <section id="models" aria-labelledby="int-h" className="sec-models overflow-hidden lg:px-10">
      <div className="lv-panel mx-auto w-full max-w-[1360px] pb-[54px] pt-[100px] max-[1279px]:pb-[60px] max-[767px]:pt-[64px]">
        <header className="mx-auto max-w-[1248px] px-4 text-center">
          <h2 id="int-h" className="lv-h2">Connects to the tools<br className="hidden max-md:inline" /> you already use.</h2>
          <p className="lv-sub mx-auto mt-[calc(16px*var(--mk-scale))] max-w-[760px]">Publish to your website, read your search data and talk to your team from one place.</p>
        </header>
        <ul aria-label="Working integrations" className="mx-auto mt-[calc(48px*var(--mk-scale))] flex max-w-[1100px] flex-wrap items-center justify-center gap-4 px-4">
          {LIVE.map(it => <li key={it.name}><Pill it={it} /></li>)}
        </ul>
        <p className="mx-auto mt-6 max-w-[640px] px-4 text-center text-[15px] leading-[1.5] text-[#525252]">More coming: Shopify, Webflow, Zapier, LinkedIn, Instagram and more.</p>
      </div>
    </section>
  );
}
