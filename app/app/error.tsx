"use client";
import Link from "next/link";
import { useEffect } from "react";

/** Error boundary for every /app page.
 *
 *  Without one, a client-side render error unmounts the segment and leaves a black rectangle
 *  where the page should be — no message, nothing in the UI to act on, and the only way to
 *  find out what happened is to open the browser console. That is exactly how the article
 *  reviewer appeared to be "empty".
 *
 *  Shows what actually broke, offers a retry that re-renders the segment without a full page
 *  load, and keeps the rest of the shell usable. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Also into the console, with the digest — that is what maps a minified production stack
    // back to a real one in the Vercel logs.
    console.error("[app] page crashed:", error);
  }, [error]);

  return (
    <div className="errwrap">
      <div className="errmark">!</div>
      <h2>This page hit an error</h2>
      <p className="errmsg">{error?.message || "Something went wrong rendering this page."}</p>
      {error?.digest && <p className="errdig">Reference: {error.digest}</p>}

      <div className="errrow">
        <button onClick={reset}>Try again</button>
        <Link href="/app">Back to the dashboard</Link>
      </div>

      <style jsx>{`
        .errwrap { max-width: 560px; margin: 8vh auto 0; text-align: center; padding: 0 20px; }
        .errmark { width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 16px;
                   display: grid; place-items: center; font-size: 26px; font-weight: 800;
                   color: #fff; background: var(--red); }
        h2 { font-size: 20px; margin: 0 0 8px; color: var(--ink); }
        .errmsg { font-size: 13px; color: var(--mut); line-height: 1.6; margin: 0;
                  word-break: break-word; }
        .errdig { font-size: 10.5px; color: var(--mut2); margin: 10px 0 0; }
        .errrow { display: flex; gap: 9px; justify-content: center; margin-top: 20px; flex-wrap: wrap; }
        .errrow button { background: var(--ac); border: none; color: #fff; font-size: 12px;
                         font-weight: 700; padding: 9px 16px; border-radius: 9px; cursor: pointer; }
        .errrow a { border: 1px solid var(--line2); color: var(--mut); font-size: 12px;
                    font-weight: 600; padding: 9px 16px; border-radius: 9px; }
      `}</style>
    </div>
  );
}
