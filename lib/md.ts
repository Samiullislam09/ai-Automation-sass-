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
  /** Rows of a GitHub-style pipe table, header first. */
  let table: string[][] | null = null;

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
  /** A pipe table becomes a real <table>.
   *
   *  Added 2026-09-18. Without it, `| Business Size | Fee |` fell through to the paragraph
   *  branch below and every row was concatenated into one run of prose full of pipe characters
   *  — which is exactly how it looked on the live writer canvas and on the reading view, even
   *  though qualityGate.ts REQUIRES every article to contain a real markdown table. The rule was
   *  enforced on the way in and then thrown away on the way out.
   *
   *  Styled inline for the same reason the <img> above is: this HTML is dropped into several
   *  different surfaces (the reading view, the live canvas, the editor) and cannot rely on any
   *  one of them having a stylesheet rule for it. */
  const flushTable = () => {
    if (!table || !table.length) { table = null; return; }
    const [head, ...body] = table;
    const cell = (c: string, tag: "th" | "td") =>
      `<${tag} style="border:1px solid rgba(128,128,140,.35);padding:6px 9px;text-align:left;vertical-align:top">${inline(c)}</${tag}>`;
    const rows = body.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
    out.push(
      `<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:.95em">` +
        `<thead><tr>${head.map((c) => cell(c, "th")).join("")}</tr></thead>` +
        `<tbody>${rows}</tbody></table>`,
    );
    table = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };

  /** `| a | b |` → ["a","b"]. The outer pipes are optional in the wild, so they are trimmed
   *  rather than required, and an escaped `\|` inside a cell stays a literal pipe. */
  const splitRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, "|").trim());

  /** The `|---|:--:|` line directly under a header is what makes the block a table rather than
   *  prose that happens to contain pipes. */
  const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = raw.trimEnd();

    // Fenced code — held verbatim, never re-interpreted.
    if (/^\s*```/.test(line)) {
      if (fence) { out.push(`<pre><code>${fence.join("\n")}</code></pre>`); fence = null; }
      else { flushAll(); fence = []; }
      continue;
    }
    if (fence) { fence.push(line); continue; }

    if (!line.trim()) { flushAll(); continue; }

    // Mr. Image's own embed markers (agent-server/src/lib/media/embed.ts) — invisible in the
    // reading view, same as they are meant to be. Checked against the ESCAPED line, since `src`
    // is escaped above with everything else; the marker itself has no characters that change
    // under escaping.
    if (/^&lt;!--\s*\/?image:[\w-]+\s*--&gt;\s*$/.test(line)) { flushAll(); continue; }

    // A line that is only an image. Checked against the escaped text the same way links are —
    // this file escapes first, so the raw `![...](url)` syntax survives as literal text and is
    // matched here before `inline()` ever sees it.
    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (image) { flushAll(); out.push(`<img src="${image[2]}" alt="${image[1]}" loading="lazy" style="max-width:100%;border-radius:8px" />`); continue; }

    // A pipe table. Recognised by its DIVIDER, not by the pipes: a header row alone is
    // indistinguishable from a sentence containing "|", and guessing wrong would swallow prose
    // into a table. Once open, every following pipe row joins it; the first line that is not a
    // pipe row closes it (flushAll below, and the blank-line branch above).
    const looksLikeRow = /\|/.test(line);
    if (table && looksLikeRow) { table.push(splitRow(line)); continue; }
    if (!table && looksLikeRow && li + 1 < lines.length && isDivider(lines[li + 1])) {
      flushAll();
      table = [splitRow(line)];
      li++; // the divider itself is structure, never content
      continue;
    }
    if (table) flushTable();

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
