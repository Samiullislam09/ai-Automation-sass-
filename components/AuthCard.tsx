"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Lock, Mail, PenLine, Search, Send, ShieldCheck, User } from "lucide-react";
import { SiWordpress } from "react-icons/si";
import { createClient } from "@/lib/supabase/client";
import { BrandMark, SHARED_CSS } from "@/components/OnboardingUI";

/** /login and /signup — rebuilt 2026-09-08 to the owner's reference mockup: a two-column light
 *  page (brand, headline, feature list and a small dashboard illustration on the left; the
 *  form card on the right), "Continue with Google" first, then email + password with icons,
 *  an eye toggle, Remember me / Forgot password on login and a Terms checkbox on signup.
 *
 *  Only Google is offered as a social sign-in. The mockup also shows Apple, GitHub and
 *  Microsoft buttons — none of those providers are configured in Supabase, and a button that
 *  errors on click is exactly the fake state this product avoids (see ConnectSection.tsx's
 *  own note). Add them here the day they are set up.
 *
 *  The auth logic is unchanged: supabase.auth.signInWithOAuth / signInWithPassword / signUp,
 *  the hard navigation after login (the cookie race that router.push used to lose), and the
 *  "check your inbox" screen after signup. New: Full Name is stored as user metadata on
 *  signup, and Forgot password sends Supabase's reset email. */

const GoogleG = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.8C43.9 38 46.5 31.8 46.5 24.5z" />
    <path fill="#FBBC05" d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z" />
    <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.4-5.8c-2 1.4-4.7 2.2-7.8 2.2-6.3 0-11.7-3.9-13.6-9.4l-7.8 6C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sentTo, setSentTo] = useState("");

  const withGoogle = async () => {
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const forgot = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) { setError("Enter your email address first, then click Forgot password."); return; }
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/auth/callback` });
    if (error) setError(error.message);
    else setNotice(`Password reset link sent to ${email.trim()}.`);
  };

  const go = async () => {
    if (!email.trim() || !password) { setError("Email and password are both required."); return; }
    if (mode === "signup") {
      if (!name.trim()) { setError("Please enter your full name."); return; }
      if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
      if (password !== confirm) { setError("The two passwords don't match."); return; }
      if (!agree) { setError("Please agree to the Terms of Service and Privacy Policy."); return; }
    }
    setError("");
    setLoading(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback`, data: { full_name: name.trim() } },
      });
      setLoading(false);
      if (error) { setError(error.message); return; }
      setSentTo(email.trim());
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setLoading(false);
      if (error) { setError(error.message); return; }
      // Hard navigation (not router.push) — guarantees the session cookie is fully
      // written before the request that middleware checks. router.push here raced
      // the cookie write and could bounce a just-logged-in user right back to /login.
      window.location.href = "/app";
    }
  };

  const login = mode === "login";

  return (
    <div className="au-page ob-ground">
      <style dangerouslySetInnerHTML={{ __html: SHARED_CSS + CSS }} />

      <aside className="au-left">
        <div className="au-brand">
          <BrandMark size={44} />
          <div>
            <b>MrLxwa</b>
            <small>GrowthTeam AI</small>
          </div>
        </div>

        {login ? (
          <>
            <h1 className="au-hero">Smarter Content.<br />More Traffic.<br /><span className="au-grad">Real Growth.</span></h1>
            <p className="au-herosub">AI agents that research, write, optimize and publish — so you can focus on what matters most.</p>
            <ul className="au-features">
              {[
                { icon: Search, bg: "#eef2ff", fg: "#4f46e5", t: "AI-Powered Strategy", d: "Finds the best keywords & topics" },
                { icon: PenLine, bg: "#f5f0ff", fg: "#7c3aed", t: "Automated Content Creation", d: "Writes high-quality articles" },
                { icon: ShieldCheck, bg: "#ecfdf5", fg: "#059669", t: "SEO Optimization", d: "Ranks your content on search engines" },
                { icon: Send, bg: "#eff6ff", fg: "#2563eb", t: "Publish & Grow", d: "To WordPress or your platform" },
              ].map((f) => (
                <li key={f.t}>
                  <span className="au-fico" style={{ background: f.bg, color: f.fg }}><f.icon size={18} /></span>
                  <div><b>{f.t}</b><p>{f.d}</p></div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h1 className="au-hero">Let&apos;s Build Your<br /><span className="au-grad">Growth Team</span></h1>
            <p className="au-herosub">Create your account and get started with AI-powered content marketing for your business.</p>
            <ul className="au-checks">
              {["AI content strategy", "SEO optimization", "Automated publishing", "Real-time analytics"].map((t) => (
                <li key={t}><span><Check size={13} strokeWidth={3} /></span>{t}</li>
              ))}
            </ul>
          </>
        )}

        {/* the mockup's dashboard illustration, as CSS: a tilted preview card with a chart
            line and the floating Google / WordPress / "AI Agents Working" badges */}
        <div className="au-illo" aria-hidden>
          <div className="au-shot">
            <div className="au-shot-bar"><i /><i /><i /></div>
            <div className="au-shot-body">
              <div className="au-shot-side"><i /><i /><i /><i /></div>
              <div className="au-shot-main">
                <div className="au-shot-tiles"><i /><i /><i /></div>
                <svg viewBox="0 0 200 60" className="au-chart" preserveAspectRatio="none">
                  <path d="M0 50 C30 45 40 30 60 32 S90 20 110 24 S140 10 160 14 S185 4 200 6" fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" />
                  <path d="M0 50 C30 45 40 30 60 32 S90 20 110 24 S140 10 160 14 S185 4 200 6 V60 H0 Z" fill="url(#g)" opacity=".18" />
                  <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4f46e5" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
                </svg>
              </div>
            </div>
          </div>
          <span className="au-badge au-b1"><GoogleG /></span>
          <span className="au-badge au-b2"><SiWordpress size={18} color="#21759B" /></span>
          <span className="au-pill"><i /> AI Agents Working</span>
        </div>

        <p className="au-quote">&ldquo;Built for small businesses.<br />Powered by AI. Focused on your growth.&rdquo;</p>
      </aside>

      <main className="au-right">
        <div className="au-toplink">
          {login
            ? <Link href="/signup">New here? <b>Create an account</b> <ArrowRight size={13} /></Link>
            : <Link href="/login">Already have an account? <b>Sign in</b> <ArrowRight size={13} /></Link>}
        </div>

        {sentTo ? (
          <div className="au-card au-center">
            <span style={{ fontSize: 40 }}>📬</span>
            <h2 className="au-h1" style={{ marginTop: 10 }}>Check your inbox</h2>
            <p className="au-sub">We sent a confirmation link to <b style={{ color: "#0f172a" }}>{sentTo}</b>. Click it to activate your team.</p>
            <Link href="/login" className="au-primary" style={{ marginTop: 6 }}>Back to sign in <ArrowRight size={15} /></Link>
          </div>
        ) : (
          <div className="au-card">
            <div className="au-brand au-brand-sm">
              <BrandMark size={34} />
              <div><b>MrLxwa</b><small>GrowthTeam AI</small></div>
            </div>
            <h2 className="au-h1">{login ? "Welcome Back" : "Create Your Account"}</h2>
            <p className="au-sub">{login ? "Sign in to your account to continue." : "Start your journey with MrLxwa and grow your business with the power of AI."}</p>

            <button type="button" className="au-google" onClick={withGoogle}>
              <span className="au-gcircle"><GoogleG /></span>
              Continue with Google
            </button>

            <div className="au-or"><span />or<span /></div>

            {!login && (
              <div className="au-field">
                <label>Full Name</label>
                <div className="au-inwrap"><User size={15} className="au-ic" /><input placeholder="Enter your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              </div>
            )}

            <div className="au-field">
              <label>Email address</label>
              <div className="au-inwrap"><Mail size={15} className="au-ic" /><input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
            </div>

            <div className="au-field">
              <label>Password</label>
              <div className="au-inwrap">
                <Lock size={15} className="au-ic" />
                <input type={showPw ? "text" : "password"} placeholder={login ? "Enter your password" : "Create a strong password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} autoComplete={login ? "current-password" : "new-password"} />
                <button type="button" className="au-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {!login && (
              <div className="au-field">
                <label>Confirm Password</label>
                <div className="au-inwrap">
                  <Lock size={15} className="au-ic" />
                  <input type={showPw2 ? "text" : "password"} placeholder="Confirm your password" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} autoComplete="new-password" />
                  <button type="button" className="au-eye" onClick={() => setShowPw2((v) => !v)} aria-label={showPw2 ? "Hide password" : "Show password"}>
                    {showPw2 ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}

            {login ? (
              <div className="au-rowline">
                <label className="au-checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span /> Remember me</label>
                <button type="button" className="au-link" onClick={forgot}>Forgot password?</button>
              </div>
            ) : (
              <label className="au-checkbox au-rowline">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span />
                <em>I agree to the <a href="/terms" className="au-link">Terms of Service</a> and <a href="/privacy" className="au-link">Privacy Policy</a></em>
              </label>
            )}

            {error && <p className="au-error">{error}</p>}
            {notice && <p className="au-notice">{notice}</p>}

            <button type="button" className="au-primary" disabled={loading} onClick={go}>
              {loading ? "One moment…" : login ? "Sign In" : "Create Account"} <ArrowRight size={15} />
            </button>

            <p className="au-legal">
              {login ? "By continuing, you agree to our " : "By creating an account, you agree to our "}
              <a href="/terms" className="au-link">Terms of Service</a> and <a href="/privacy" className="au-link">Privacy Policy</a>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

const CSS = `
.au-page{position:relative;min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#0f172a}
.au-page::before{content:"";position:absolute;right:0;top:0;width:52%;height:100%;pointer-events:none;
  background:linear-gradient(160deg,rgba(219,234,254,.45),rgba(237,233,254,.25));clip-path:ellipse(72% 82% at 100% 42%)}
.au-left,.au-right{position:relative;z-index:1;min-height:0}
.au-left{display:flex;flex-direction:column;padding:28px 36px 24px 52px;max-width:600px}
.au-right{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 40px;gap:12px}
.au-brand{display:flex;align-items:center;gap:10px}
.au-brand b{display:block;font-size:22px;font-weight:800;line-height:1.1;letter-spacing:-.01em}
.au-brand small{display:block;font-size:13px;color:#64748b;line-height:1.3}
.au-brand-sm{margin-bottom:14px}
.au-brand-sm b{font-size:17px}
.au-brand-sm small{font-size:11.5px}
.au-hero{margin:28px 0 0;font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-.02em}
.au-grad{background:linear-gradient(90deg,#4f46e5,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent}
.au-herosub{margin:14px 0 0;font-size:14.5px;line-height:1.65;color:#475569;max-width:400px}
.au-features{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.au-features li{display:flex;gap:12px;align-items:center}
.au-fico{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;flex-shrink:0}
.au-features b{display:block;font-size:13.5px;font-weight:700}
.au-features p{margin:1px 0 0;font-size:12px;color:#64748b}
.au-checks{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.au-checks li{display:flex;align-items:center;gap:11px;font-size:14px;font-weight:600;color:#1e293b}
.au-checks span{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:#22c55e;color:#fff;flex-shrink:0}
.au-illo{position:relative;margin:26px 0 0 8px;width:300px;height:190px}
.au-shot{position:absolute;left:0;top:14px;width:250px;border-radius:14px;background:#fff;border:1px solid #e6e8f2;
  box-shadow:0 30px 50px -20px rgba(30,41,63,.28);transform:perspective(900px) rotateY(-14deg) rotateX(6deg);overflow:hidden}
.au-shot-bar{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid #eef0f6}
.au-shot-bar i{width:6px;height:6px;border-radius:999px;background:#d8dbea}
.au-shot-body{display:flex}
.au-shot-side{width:46px;padding:10px 8px;display:flex;flex-direction:column;gap:7px;border-right:1px solid #eef0f6}
.au-shot-side i{height:6px;border-radius:3px;background:#e6e8f2}
.au-shot-side i:first-child{background:#c7d2fe}
.au-shot-main{flex:1;padding:10px}
.au-shot-tiles{display:flex;gap:6px;margin-bottom:8px}
.au-shot-tiles i{flex:1;height:22px;border-radius:6px;background:#f3f4fa;border:1px solid #eef0f6}
.au-chart{display:block;width:100%;height:56px}
.au-badge{position:absolute;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;background:#fff;
  border:1px solid #e6e8f2;box-shadow:0 12px 24px -10px rgba(30,41,63,.3)}
.au-b1{left:-14px;top:0}
.au-b2{right:20px;top:-6px}
.au-pill{position:absolute;right:0;bottom:8px;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#fff;
  border:1px solid #e6e8f2;box-shadow:0 10px 20px -10px rgba(30,41,63,.3);font-size:11px;font-weight:600;color:#1e293b}
.au-pill i{width:7px;height:7px;border-radius:999px;background:#22c55e}
.au-quote{margin:auto 0 0;padding-top:22px;font-size:12.5px;line-height:1.6;color:#64748b;font-style:italic}
.au-toplink{align-self:flex-end}
.au-toplink a{display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:999px;background:#fff;border:1px solid #e6e8f2;
  font-size:12.5px;color:#475569;text-decoration:none;box-shadow:0 6px 16px -10px rgba(30,41,63,.25)}
.au-toplink b{color:#4f46e5;font-weight:600}
.au-card{width:100%;max-width:400px;box-sizing:border-box;padding:22px 24px 18px;border-radius:20px;background:#fff;border:1px solid #eceef6;
  box-shadow:0 30px 70px -20px rgba(30,41,63,.18),0 8px 24px -8px rgba(30,41,63,.08)}
.au-center{text-align:center;display:flex;flex-direction:column;align-items:center}
.au-h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.015em;line-height:1.2}
.au-sub{margin:6px 0 16px;font-size:13px;color:#64748b;line-height:1.55}
.au-google{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;height:42px;border-radius:12px;border:none;cursor:pointer;
  background:#2563eb;color:#fff;font-size:14px;font-weight:650;font-family:inherit;box-shadow:0 10px 22px -8px rgba(37,99,235,.55);transition:.15s}
.au-google:hover{background:#1d4ed8}
.au-gcircle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:#fff}
.au-or{display:flex;align-items:center;gap:12px;margin:12px 0 10px;font-size:11.5px;color:#94a3b8}
.au-or span{flex:1;height:1px;background:#e6e8f2}
.au-field{margin-bottom:10px}
.au-field label{display:block;margin-bottom:5px;font-size:12.5px;font-weight:600;color:#1e293b}
.au-inwrap{position:relative;display:flex;align-items:center}
.au-ic{position:absolute;left:12px;color:#94a3b8;pointer-events:none}
.au-inwrap input{width:100%;height:41px;padding:0 40px 0 38px;border-radius:11px;background:#fff;border:1.5px solid #e2e5f2;color:#0f172a;
  font-size:13.5px;outline:none;box-sizing:border-box;font-family:inherit;transition:.15s}
.au-inwrap input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
.au-inwrap input::placeholder{color:#a3a9c2}
.au-eye{position:absolute;right:10px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:none;color:#94a3b8;cursor:pointer}
.au-eye:hover{color:#475569}
.au-rowline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 14px;font-size:12.5px;color:#334155}
.au-checkbox{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:#334155}
.au-checkbox input{position:absolute;opacity:0;width:0;height:0}
.au-checkbox span{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:5px;border:1.5px solid #cbd0e2;background:#fff;flex-shrink:0;transition:.15s}
.au-checkbox input:checked+span{background:#4f46e5;border-color:#4f46e5}
.au-checkbox input:checked+span::after{content:"";width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);margin-top:-2px}
.au-checkbox em{font-style:normal}
.au-link{background:none;border:none;padding:0;color:#4f46e5;font-size:inherit;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}
.au-link:hover{text-decoration:underline}
.au-error{margin:0 0 10px;font-size:12.5px;color:#dc2626}
.au-notice{margin:0 0 10px;font-size:12.5px;color:#16a34a}
.au-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:43px;border-radius:12px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#4f46e5,#6d5bf5);color:#fff;font-size:14.5px;font-weight:650;font-family:inherit;text-decoration:none;
  box-shadow:0 10px 22px -8px rgba(79,70,229,.55);transition:.15s;box-sizing:border-box}
.au-primary:hover:not(:disabled){filter:brightness(1.06)}
.au-primary:disabled{opacity:.6;cursor:not-allowed}
.au-legal{margin:12px 0 0;text-align:center;font-size:11.5px;line-height:1.6;color:#64748b}
@media (max-height:760px){.au-illo{display:none}}
@media (max-width:980px){
  .au-page{grid-template-columns:1fr}
  .au-page::before{display:none}
  .au-left{display:none}
  .au-right{padding:18px 14px 28px;justify-content:flex-start}
}
@media (max-width:480px){
  .au-card{padding:20px 16px 18px;border-radius:16px}
  .au-h1{font-size:21px}
}
`;
