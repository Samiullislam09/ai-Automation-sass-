import Link from "next/link";
import Office from "@/components/Office";

const faq = [
  { q: "Do I need any marketing knowledge?", a: "No. You paste your website, tap a few options, and your AI team handles research, writing and distribution. Your only job is approving with one tap." },
  { q: "Will AI publish without my permission?", a: "Never. Every article, post and reply waits in your approval queue. Nothing touches your website or accounts until you approve it — that's the core of the product." },
  { q: "How is this different from ChatGPT or Jasper?", a: "Those are tools you operate. This is a team that operates for you: it finds topics from your real search data, analyzes the top 10 ranking pages, writes to outrank them, distributes everywhere, and reports daily — you just approve." },
  { q: "What are tokens?", a: "Monthly content credits. An article costs 10, a story 4, a social post 1. Free plan includes 10 tokens (one full article) every month, forever." },
  { q: "Can I cancel anytime?", a: "Yes — one click, no calls, and you keep all your content, memory and reports." },
];

export default function Landing() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "SoftwareApplication", name: "GrowthTeam AI", applicationCategory: "BusinessApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, description: "AI marketing team for small businesses — articles, social, leads, SEO, human-approved." },
      { "@type": "FAQPage", mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav style={{ position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", gap: 20, padding: "14px 5vw", background: "#0a0e18cc", backdropFilter: "blur(12px)", borderBottom: "1px solid #16203a" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 16.5, color: "var(--ink)" }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,var(--ac),#2bb99a)", display: "grid", placeItems: "center", color: "#04120d", fontSize: 13 }}>⚡</span>GrowthTeam AI
        </Link>
        <div style={{ display: "flex", gap: 22, marginLeft: 26, fontSize: 13.5 }} className="navlinks">
          <a href="#office" style={{ color: "var(--mut)" }}>Your team</a><a href="#feat" style={{ color: "var(--mut)" }}>Features</a><a href="#pricing" style={{ color: "var(--mut)" }}>Pricing</a><a href="#faq" style={{ color: "var(--mut)" }}>FAQ</a>
        </div>
        <div style={{ flex: 1 }} />
        <Link className="btn btn-g btn-sm" href="/login">Log in</Link>
        <Link className="btn btn-p btn-sm" href="/signup">Start free</Link>
      </nav>

      <header style={{ padding: "78px 5vw 50px", textAlign: "center", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 16px", fontSize: 12.5, color: "var(--mut)", marginBottom: 26, animation: "fadeup .7s ease" }}>
          ✦ <b className="acc">The first AI team you can actually see working</b>
        </div>
        <h1 style={{ fontSize: "clamp(34px,5.6vw,58px)", fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.15, animation: "fadeup .7s .08s ease backwards" }}>
          Meet your <span style={{ background: "linear-gradient(100deg,var(--ac),var(--blu) 60%,var(--vio))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>AI marketing team</span>
        </h1>
        <p style={{ fontSize: "clamp(15px,1.8vw,18px)", color: "var(--mut)", maxWidth: 660, margin: "20px auto 34px", animation: "fadeup .7s .16s ease backwards" }}>
          Six agents research, write ranking articles, post everywhere, find leads and care for your website —
          in a live office you can watch, with <b style={{ color: "var(--ink)" }}>every action approved by you</b>.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", animation: "fadeup .7s .24s ease backwards" }}>
          <Link className="btn btn-p" href="/signup">Hire your team free — no card</Link>
          <a className="btn btn-g" href="#office">Watch them work ↓</a>
        </div>
      </header>

      <section id="office" style={{ padding: "0 5vw 60px", maxWidth: 940, margin: "0 auto" }}>
        <Office demo />
        <p className="sm mut" style={{ textAlign: "center", marginTop: 14 }}>
          This is your real dashboard — rooms light up as agents work, go dark when off, and yes, Chacha serves chai. ☕
        </p>
      </section>

      <section id="feat" style={{ padding: "50px 5vw", maxWidth: 1080, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(24px,3.4vw,36px)", textAlign: "center", letterSpacing: -0.6 }}>Everything a marketing hire would do</h2>
        <p className="mut" style={{ textAlign: "center", maxWidth: 620, margin: "12px auto 44px" }}>One subscription replaces a content writer, a social manager, an SEO freelancer and a lead-gen tool — with none of them going rogue.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
          {[["📝", "Articles built to compete", "We analyze the top 10 results for your keyword, map their gaps, build a blueprint — then write something more complete. Method, not magic."],
            ["📣", "Every platform, one approval", "Facebook, Instagram, X and LinkedIn auto-posted. Quora & Reddit drafted ready-to-paste, so your accounts never get banned."],
            ["🎯", "Leads with a reason", "Define your ideal customer once. Every lead arrives scored, verified, and with the reason it fits — no junk lists."],
            ["🛡️", "You approve everything", "Nothing publishes without your tap. Edit, approve or reject from your phone in seconds."],
            ["🗒", "A report every day", "Boss AI writes you a short daily report: what was done, what's next. A manager's standup without the meeting."],
            ["🔧", "Your site, cared for daily", "Broken links, slow pages, dropping rankings — detected daily, fixed with your approval."]]
            .map((f, i) => (
              <div className="card" key={i} style={{ padding: 22 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", fontSize: 18, background: "var(--panel2)", border: "1px solid var(--line)", marginBottom: 14 }}>{f[0]}</div>
                <h3 style={{ fontSize: 16, marginBottom: 7 }}>{f[1]}</h3>
                <p className="sm mut" style={{ margin: 0 }}>{f[2]}</p>
              </div>
            ))}
        </div>
      </section>

      <section style={{ padding: "50px 5vw", maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(22px,3vw,32px)", textAlign: "center", letterSpacing: -0.5 }}>Why teams pick us over AI tools</h2>
        <div style={{ overflowX: "auto", marginTop: 30 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 560 }}>
            <thead><tr style={{ color: "var(--mut)", fontSize: 12 }}>
              <th style={{ textAlign: "left", padding: "10px 12px" }}></th>
              <th style={{ padding: "10px 12px", color: "var(--ac)" }}>GrowthTeam AI</th>
              <th style={{ padding: "10px 12px" }}>AI writing tools</th>
              <th style={{ padding: "10px 12px" }}>Enterprise AI agents</th>
            </tr></thead>
            <tbody>
              {[["Works without prompting", "✓ Team runs on your schedule", "✗ You operate it", "✓ But enterprise setup"],
                ["You see the team working", "✓ Live animated office", "✗ Text box", "✗ Config dashboards"],
                ["Human approval built-in", "✓ Every single action", "—", "Partial"],
                ["Small-business pricing", "✓ Free, then $5", "$39–99/mo", "$1,000s + contracts"],
                ["Leads + content + SEO together", "✓ One team", "Content only", "Usually one lane"]]
                .map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "11px 12px", color: "var(--mut)" }}>{r[0]}</td>
                    <td style={{ padding: "11px 12px", textAlign: "center", background: "#12352c22", color: "var(--ink)", fontWeight: 600 }}>{r[1]}</td>
                    <td style={{ padding: "11px 12px", textAlign: "center", color: "var(--mut)" }}>{r[2]}</td>
                    <td style={{ padding: "11px 12px", textAlign: "center", color: "var(--mut)" }}>{r[3]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="pricing" style={{ padding: "50px 5vw", maxWidth: 1000, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(24px,3.4vw,36px)", textAlign: "center", letterSpacing: -0.6 }}>Simple, honest pricing</h2>
        <p className="mut" style={{ textAlign: "center", margin: "12px auto 44px" }}>Start free forever. Upgrade when your team earns it.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16, maxWidth: 880, margin: "0 auto" }}>
          {[{ n: "Free", p: 0, d: "1 full article every month", hot: false, li: ["10 tokens / month", "Full SERP article pipeline", "All 6 agents & daily reports", "No card required"] },
            { n: "Starter", p: 5, d: "~10 articles + stories & posts", hot: true, li: ["120 tokens / month", "Mix articles, stories & posts", "Priority pipeline", "Everything in Free"] },
            { n: "Growth", p: 15, d: "Volume + premium model + leads", hot: false, li: ["400 tokens / month", "Premium writing model", "Lead generation included", "Everything in Starter"] }]
            .map((p, i) => (
              <div key={i} className="card" style={{ padding: 26, position: "relative", ...(p.hot ? { borderColor: "var(--ac)", boxShadow: "0 0 0 1px var(--ac),0 20px 50px #4fe3c11a" } : {}) }}>
                {p.hot && <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "var(--ac)", color: "#04120d", fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 999 }}>MOST POPULAR</div>}
                <h3 style={{ fontSize: 15 }}>{p.n}</h3>
                <div style={{ fontSize: 38, fontWeight: 800, margin: "10px 0 2px" }}>${p.p}<small style={{ fontSize: 14, color: "var(--mut)", fontWeight: 500 }}>/mo</small></div>
                <div className="sm mut">{p.d}</div>
                <ul style={{ listStyle: "none", margin: "16px 0 20px", padding: 0 }}>
                  {p.li.map((l, j) => <li key={j} className="sm mut" style={{ padding: "5px 0", display: "flex", gap: 9 }}><span className="acc" style={{ fontWeight: 700 }}>✓</span>{l}</li>)}
                </ul>
                <Link className={"btn " + (p.hot ? "btn-p" : "btn-g")} style={{ width: "100%" }} href="/signup">Start free</Link>
              </div>
            ))}
        </div>
      </section>

      <section id="faq" style={{ padding: "50px 5vw 70px", maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(22px,3vw,32px)", textAlign: "center", letterSpacing: -0.5, marginBottom: 34 }}>Questions, answered</h2>
        {faq.map((f, i) => (
          <details key={i} className="card" style={{ marginBottom: 10, padding: "16px 20px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14.5 }}>{f.q}</summary>
            <p className="sm mut" style={{ marginTop: 10 }}>{f.a}</p>
          </details>
        ))}
      </section>

      <footer style={{ borderTop: "1px solid #16203a", padding: "34px 5vw", textAlign: "center", color: "var(--mut2)", fontSize: 12.5 }}>
        © 2026 GrowthTeam AI · Human-approved, always · <a href="/">Terms</a> · <a href="/">Privacy</a>
      </footer>
    </main>
  );
}
