import {
  Bot, Globe, Brain, Search, PenLine, ShieldCheck, Send, Gauge, Users, Share2, Wand2, Image as ImageIcon,
  Film, MessageCircle, Mail, BarChart3, HardDrive, type LucideIcon,
} from "lucide-react";

/** The agents shown on the home page.
 *
 *  STATUS IS DELIBERATE: a badge says "live" only when the agent is wired into the product
 *  (a dashboard page, an API route or the chat manager reaches it).
 *   - live : works in the product today
 *   - beta : the agent exists but part of the promise is not finished
 *   - soon : planned, not available yet
 *  Update `status` here as agents graduate; every section on the page reads this file. */
export type AgentStatus = "live" | "beta" | "soon";

export type AgentCard = {
  id: string;
  name: string;
  job: string;      // one line, in the user's words
  gets?: string;    // what the customer ends up with
  status: AgentStatus;
  icon: LucideIcon;
  color: string;    // icon colour
  tint: string;     // icon tile background
  main?: boolean;   // shown in the "Meet your team" row
  note?: string;    // honest caveat shown on the card
};

export const AGENTS_LIST: AgentCard[] = [
  { id: "boss", name: "MenCra", job: "Your manager. Tell it what you need in plain words and it starts the right agent.", gets: "A plan, and live status updates", status: "live", icon: Bot, color: "#6a5af0", tint: "#efecff", main: true },
  { id: "crawler", name: "Site Crawler", job: "Reads your website page by page.", gets: "A map of all your pages", status: "live", icon: Globe, color: "#2563eb", tint: "#e8f0ff" },
  { id: "analyst", name: "Mr. Analyst", job: "Works out what your business does, who it is for and how it sounds.", gets: "Your Site Brain profile", status: "live", icon: Brain, color: "#7c3aed", tint: "#f1eaff" },
  { id: "keyword", name: "Mr. Keyword", job: "Finds what people search for, using real search data.", gets: "Ranked keywords, with measured and suggested clearly labelled", status: "live", icon: Search, color: "#d97706", tint: "#fdf1e0", main: true },
  { id: "writer", name: "Mr. Writer", job: "Writes the article in your tone and links to your own pages.", gets: "A finished draft", status: "live", icon: PenLine, color: "#6a5af0", tint: "#efecff", main: true },
  { id: "qa", name: "Mr. QA", job: "Checks every draft before you see it: length, structure and links.", gets: "A pass or fail, with the reason", status: "live", icon: ShieldCheck, color: "#0f766e", tint: "#e3f4f2", main: true },
  { id: "publish", name: "Mr. Publish", job: "Puts approved articles on your website (WordPress or webhook).", gets: "A live article and a record of it", status: "live", icon: Send, color: "#21759B", tint: "#e4f0f6", main: true },
  { id: "audit", name: "Site Audit", job: "Checks your pages and speed and lists what to fix.", gets: "A site audit report", status: "live", icon: Gauge, color: "#16a34a", tint: "#e5f6ec" },

  { id: "leads", name: "Mr. Lead", job: "Finds businesses that match your ideal customer and drafts a first message.", gets: "A list of leads with draft messages", status: "beta", icon: Users, color: "#4f46e5", tint: "#ebeafd" },
  { id: "social", name: "Miss Social", job: "Drafts social posts for each article.", gets: "Post drafts you can edit", status: "beta", icon: Share2, color: "#e1306c", tint: "#fde8f0", note: "Auto-posting is not available yet." },

  { id: "seo", name: "Mr. SEO", job: "Improves a draft that needs work, up to two rewrites.", gets: "A stronger draft", status: "soon", icon: Wand2, color: "#9333ea", tint: "#f4e8fd" },
  { id: "image", name: "Mr. Image", job: "Creates the pictures that go with an article.", gets: "Images for every article", status: "soon", icon: ImageIcon, color: "#0284c7", tint: "#e3f2fb" },
  { id: "story", name: "Mr. Story", job: "Turns an article into a Web Story.", gets: "A ready Web Story", status: "soon", icon: Film, color: "#db2777", tint: "#fce8f2" },
  { id: "reply", name: "Mr. Reply", job: "Drafts answers to comments, for you to approve.", status: "soon", icon: MessageCircle, color: "#0891b2", tint: "#e2f5f9" },
  { id: "email", name: "Mr. Email", job: "Drafts outreach emails, for you to approve.", status: "soon", icon: Mail, color: "#ea580c", tint: "#fdeee3" },
  { id: "analytics", name: "Miss Analytics", job: "Shows you what is working.", status: "soon", icon: BarChart3, color: "#16a34a", tint: "#e5f6ec" },
  { id: "backup", name: "Mr. Backup", job: "Keeps a backup of your site.", status: "soon", icon: HardDrive, color: "#475569", tint: "#edf0f4" },
];

export const STATUS_LABEL: Record<AgentStatus, string> = { live: "Live", beta: "Beta", soon: "Coming soon" };
export const STATUS_STYLE: Record<AgentStatus, { bg: string; fg: string; dot: string }> = {
  live: { bg: "#e7f6ee", fg: "#0b7a4f", dot: "#16a34a" },
  beta: { bg: "#fdf1e0", fg: "#92560e", dot: "#d97706" },
  soon: { bg: "#f1f1f3", fg: "#6b6b73", dot: "#a1a1aa" },
};
