/** Shown while an /app page's segment is still resolving.
 *
 *  Next wraps every page segment in Suspense. Without a fallback, a segment that is pending —
 *  or that goes wrong in a way React doesn't surface as an error — renders literally nothing,
 *  and you get a black rectangle with a clean console and no error boundary hit. That is
 *  exactly what the article reviewer looked like, and it cost hours because "blank with no
 *  error" gives you nothing to chase.
 *
 *  A page can now be slow, and it can even fail to resolve, but it can never again be silently
 *  invisible. */
export default function AppLoading() {
  return (
    <div style={{ padding: "24px 0", display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid var(--line2)",
          borderTopColor: "var(--ac)",
          animation: "app-load-spin .8s linear infinite",
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 12.5, color: "var(--mut)" }}>Loading…</span>
      <style>{`@keyframes app-load-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
