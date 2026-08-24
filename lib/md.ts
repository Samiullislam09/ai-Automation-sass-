/** Markdown -> HTML for the article reading view.
 *
 *  Written here rather than importing `marked` into the browser bundle. Two reasons, and the
 *  second is the one that matters: marked ships an ESM `exports` map alongside a `browser`
 *  field pointing at a UMD build, and that disagreement is exactly the shape of dependency
 *  that resolves fine at build time and then fails to evaluate in the client — which is what
 *  the reviewer's blank page looked like. The articles this renders are model-written
 *  markdown with a known, small vocabulary; a 90-line renderer covers all of it with nothing
 *  to disagree about.
 *
 *  SAFETY: every character is HTML-escaped BEFORE any markdown is interpreted, so the only
 *  tags that can reach the DOM are the ones this file emits. Nothing in a draft — model
 *  written or hand-edited afterwards — can inject markup into the page it renders into.
 *  Deliberate inline HTML shows as text, which is the right trade for an article.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Inline rules, applied to already-escaped text. Order matters: code first, so that
 *  `**not bold**` inside backticks stays literal. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links: only http(s) and relative paths. A javascript: URL is not a link, it's a script.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
}

export function renderMarkdown(md: string): string {
  const src = escapeHtml(String(md ?? "").replace(/\r\n/g, "\n"));
  const lines = src.split("\n");
  const out: string[] = [];

  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Fenced code — held verbatim, never re-interpreted.
    if (/^\s*```/.test(line)) {
      if (fence) { out.push(`<pre><code>${fence.join("\n")}</code></pre>`); fence = null; }
      else { flushAll(); fence = []; }
      continue;
    }
    if (fence) { fence.push(line); continue; }

    if (!line.trim()) { flushAll(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) { flushAll(); out.push("<hr />"); continue; }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph(); flushQuote();
      if (list?.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph(); flushQuote();
      if (list?.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }

    const quoted = line.match(/^\s*&gt;\s?(.*)$/); // '>' is already escaped by this point
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }

    flushList(); flushQuote();
    paragraph.push(line.trim());
  }

  if (fence) out.push(`<pre><code>${fence.join("\n")}</code></pre>`);
  flushAll();
  return out.join("\n");
}
