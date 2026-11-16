"use client";
import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/brand";
import { Logo } from "@/components/landing-v2/Logo";

/** /login and /signup. Restyled to match the home page: one centred column on a white page with
 *  a soft mint glow at the top, a dark pill "Continue with Google" button, an "or continue with
 *  your email" divider and pill inputs.
 *
 *  Only Google is offered as a social sign-in; Apple, GitHub and Microsoft are not configured in
 *  Supabase and a button that errors on click is the fake state this product avoids.
 *
 *  The auth logic is unchanged: supabase.auth.signInWithOAuth / signInWithPassword / signUp,
 *  the hard navigation after login (the cookie race that router.push used to lose), the
 *  "check your inbox" screen after signup, Full Name stored as user metadata on signup, and
 *  Forgot password sending Supabase's reset email. */

const GoogleG = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
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
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  // Not pre-ticked: agreeing to the Terms and Privacy Policy has to be a visible choice.
  const [agree, setAgree] = useState(false);
  // What is wrong, shown under the field it belongs to. The buttons stay clickable: a disabled button never said what was missing.
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string; agree?: string }>({});
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
    const fe: { email?: string; password?: string; agree?: string } = {};
    if (!email.trim()) fe.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) fe.email = "That does not look like an email address. Check for typos.";
    if (!password) fe.password = mode === "signup" ? "Choose a password of at least 8 characters." : "Enter your password.";
    else if (mode === "signup" && password.length < 8) fe.password = "Use at least 8 characters. Right now it is " + password.length + ".";
    if (mode === "signup" && !agree) fe.agree = "Please tick the box to agree to the Terms and the Privacy Policy.";
    setFieldErr(fe);
    if (fe.email || fe.password || fe.agree) {
      const first = fe.email ? "lg-email" : fe.password ? "lg-pw" : "lg-agree";
      document.getElementById(first)?.focus();
      return;
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
      window.location.href = "/dashboard";
    }
  };

  const login = mode === "login";

  return (
    <div className="lg-page">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@300..800&display=swap" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="lg-wrap">
        <Link href="/" className="lg-logo" aria-label={BRAND.name}><Logo /></Link>

        {sentTo ? (
          <div className="lg-center">
            <h1 className="lg-h1">Check your inbox</h1>
            <p className="lg-sub">We sent a confirmation link to <b>{sentTo}</b>. Click it to activate your team.</p>
            <Link href="/login" className="lg-primary">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="lg-h1">{login ? `Welcome to ${BRAND.name}` : "Create your account"}</h1>
            <p className="lg-sub">{login ? "Choose how you would like to sign in" : "Choose how you would like to sign up"}</p>

            <button type="button" className="lg-google" onClick={withGoogle}><GoogleG />Continue with Google</button>

            <div className="lg-or"><span />OR CONTINUE WITH YOUR EMAIL<span /></div>

            {!login && (
              <div className="lg-field">
                <label htmlFor="lg-name">Full name <span className="lg-opt">(optional)</span></label>
                <input id="lg-name" placeholder="Enter your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}

            <div className="lg-field">
              <label htmlFor="lg-email">Email Address</label>
              <input id="lg-email" type="email" placeholder="Enter your email address" value={email} onChange={(e) => { setEmail(e.target.value); if (fieldErr.email) setFieldErr((f) => ({ ...f, email: undefined })); }} autoComplete="email"
                aria-invalid={!!fieldErr.email} aria-describedby={fieldErr.email ? "lg-email-err" : undefined} />
              {fieldErr.email && <p id="lg-email-err" className="lg-ferr" role="alert">{fieldErr.email}</p>}
            </div>

            <div className="lg-field">
              <label htmlFor="lg-pw">Password</label>
              <div className="lg-pwwrap">
                <input id="lg-pw" type={showPw ? "text" : "password"} placeholder={login ? "Enter your password" : "Create a strong password"} value={password}
                  onChange={(e) => { setPassword(e.target.value); if (fieldErr.password) setFieldErr((f) => ({ ...f, password: undefined })); }} onKeyDown={(e) => e.key === "Enter" && go()} autoComplete={login ? "current-password" : "new-password"}
                  aria-invalid={!!fieldErr.password} aria-describedby={fieldErr.password ? "lg-pw-err" : !login ? "lg-pw-hint" : undefined} />
                <button type="button" className="lg-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {fieldErr.password && <p id="lg-pw-err" className="lg-ferr" role="alert">{fieldErr.password}</p>}
              {!login && !fieldErr.password && <p id="lg-pw-hint" className="lg-hint">At least 8 characters. Use the eye icon to check what you typed.</p>}
            </div>

            {login ? (
              <div className="lg-row">
                <label className="lg-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span /> Remember me</label>
                <button type="button" className="lg-link" onClick={forgot}>Forgot password?</button>
              </div>
            ) : (
              <label className="lg-check lg-terms">
                <input id="lg-agree" type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); if (fieldErr.agree) setFieldErr((f) => ({ ...f, agree: undefined })); }} aria-invalid={!!fieldErr.agree} /><span />
                <em>I agree to the <a href="/terms" className="lg-link">Terms &amp; Conditions</a> and the <a href="/privacy" className="lg-link">Privacy Policy</a>.</em>
              </label>
            )}

            {fieldErr.agree && <p className="lg-ferr" role="alert">{fieldErr.agree}</p>}
            {error && <p className="lg-error" role="alert">{error}</p>}
            {notice && <p className="lg-notice">{notice}</p>}

            <button type="button" className="lg-primary" disabled={loading} onClick={go}>
              {loading ? "One moment…" : login ? "Sign in" : "Create account"}
            </button>

            <p className="lg-switch">
              {login ? <>New here? <Link href="/signup" className="lg-link">Create an account</Link></>
                : <>Already have an account? <Link href="/login" className="lg-link">Sign in</Link></>}
            </p>
            {login && <p className="lg-legal">By continuing, you agree to our <a href="/terms" className="lg-link">Terms of Service</a> and <a href="/privacy" className="lg-link">Privacy Policy</a>.</p>}
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.lg-page{min-height:100vh;background:#fff;
  background-image:radial-gradient(ellipse 60% 340px at 50% -40px,#d9d2ff 0%,rgba(239,236,255,.55) 45%,rgba(255,255,255,0) 100%);
  background-repeat:no-repeat;
  font-family:"Google Sans Flex","Plus Jakarta Sans",system-ui,sans-serif;color:#1d2125;-webkit-font-smoothing:antialiased;
  display:flex;justify-content:center;padding:48px 16px 56px;box-sizing:border-box}
.lg-page *{box-sizing:border-box;font-family:inherit}
.lg-wrap{width:100%;max-width:440px;display:flex;flex-direction:column}
.lg-logo{align-self:center;margin-bottom:28px;text-decoration:none}
.lg-center{display:flex;flex-direction:column;align-items:center;text-align:center}
.lg-h1{margin:0;text-align:center;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-.02em;color:#1d2125}
.lg-sub{margin:10px 0 32px;text-align:center;font-size:16px;line-height:1.5;color:#737373}
.lg-sub b{color:#1d2125}
.lg-google,.lg-primary{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:48px;border:none;border-radius:999px;
  background:#1d2125;color:#fcfcfd;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;transition:background .15s}
.lg-google:hover,.lg-primary:hover:not(:disabled){background:#363c42}
.lg-primary{margin-top:8px}
.lg-primary:disabled{background:#d8d8df;color:#8b8d98;cursor:not-allowed}
.lg-or{display:flex;align-items:center;gap:14px;margin:30px 0 24px;font-size:12px;letter-spacing:.06em;color:#5f6368;white-space:nowrap}
.lg-or span{flex:1;height:1px;background:#e5e5e5}
.lg-field{margin-bottom:18px}
.lg-field label{display:block;margin-bottom:8px;font-size:16px;font-weight:600;color:#1d2125}
.lg-field input{width:100%;height:48px;padding:0 20px;border-radius:999px;border:1px solid #d9d9de;background:#fff;color:#1d2125;font-size:16px;outline:none;transition:border-color .15s,box-shadow .15s}
.lg-field input::placeholder{color:#8b8d98}
.lg-field input:focus{border-color:#6a5af0;box-shadow:0 0 0 3px rgba(106,90,240,.15)}
.lg-pwwrap{position:relative}
.lg-pwwrap input{padding-right:52px}
.lg-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);display:flex;width:36px;height:36px;align-items:center;justify-content:center;border:none;background:none;color:#8b8d98;cursor:pointer}
.lg-eye:hover{color:#1d2125}
.lg-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 12px;font-size:15px;color:#737373}
.lg-check{display:inline-flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:15px;line-height:1.5;color:#737373}
.lg-check input{position:absolute;opacity:0;width:0;height:0}
.lg-check span{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:3px;border-radius:4px;border:1px solid rgba(0,5,31,.45);background:#fff;flex-shrink:0}
.lg-check input:checked+span{background:#1d2125;border-color:#1d2125}
.lg-check input:checked+span::after{content:"";width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);margin-top:-2px}
.lg-check input:focus-visible+span{outline:2px solid #6a5af0;outline-offset:2px}
.lg-check em{font-style:normal}
.lg-terms{margin:4px 0 12px}
.lg-link{background:none;border:none;padding:0;color:#1d2125;font-size:inherit;text-decoration:underline;cursor:pointer;font-weight:inherit}
.lg-link:hover{color:#6a5af0}
.lg-error{margin:0 0 8px;font-size:14px;color:#dc2626}
.lg-notice{margin:0 0 8px;font-size:14px;color:#5242d8}
.lg-switch{margin:20px 0 0;text-align:center;font-size:15px;color:#737373}
.lg-legal{margin:14px 0 0;text-align:center;font-size:13px;line-height:1.5;color:#5f6368}
.lg-ferr{margin:6px 4px 0;font-size:13.5px;line-height:1.4;color:#c81e1e}
.lg-hint{margin:6px 4px 0;font-size:13px;line-height:1.4;color:#5f6368}
.lg-opt{font-weight:400;color:#5f6368;font-size:14px}
.lg-field input[aria-invalid=true]{border-color:#c81e1e}
@media (max-width:480px){.lg-page{padding-top:32px}.lg-h1{font-size:26px}}
`;
