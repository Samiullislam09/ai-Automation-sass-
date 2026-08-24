/** Nav + topbar icons, copied verbatim from the AI Command Center reference build's sidebar
 *  markup (components/dashboard/AICommandCenter.tsx) so /app/** uses the same icon set rather
 *  than the emoji the shell used before. All stroke-based, all inherit currentColor. */
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icon = {
  dashboard: (
    <svg {...S}><path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
  ),
  content: (
    <svg {...S}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h5M10 16.5h5" /></svg>
  ),
  approvals: (
    <svg {...S}><path d="M12 3l8 3v6c0 4.6-3.2 7.6-8 9-4.8-1.4-8-4.4-8-9V6z" /><path d="M8.8 12.2l2.3 2.3 4.2-4.5" /></svg>
  ),
  reports: (
    <svg {...S}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4.5" /></svg>
  ),
  memory: (
    <svg {...S}>
      <rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 8V4.5" /><circle cx="12" cy="3.5" r="1.2" />
      <circle cx="9.3" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 16.3h5" />
    </svg>
  ),
  billing: (
    <svg {...S}><path d="M9 7V3M15 7V3" /><path d="M6.5 7h11v4a5.5 5.5 0 01-11 0z" /><path d="M12 16.5V21" /></svg>
  ),
  connect: (
    <svg {...S}>
      <path d="M9.5 14.5l5-5" />
      <path d="M13 6.5l1.4-1.4a3.4 3.4 0 014.8 4.8L17.8 11.3" />
      <path d="M11 17.5l-1.4 1.4a3.4 3.4 0 01-4.8-4.8L6.2 12.7" />
    </svg>
  ),
  schedule: (
    <svg {...S}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 9.5h17" />
      <path d="M8 3.5V6M16 3.5V6" /><path d="M12 12.5V15l1.8 1.2" />
    </svg>
  ),
  analytics: (
    <svg {...S}><path d="M4 20h16" /><path d="M7 20v-6M12 20V9M17 20V4.5" /></svg>
  ),
  activity: (
    <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
  ),
  menu: (
    <svg {...S} strokeWidth={2.4}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
  bell: (
    <svg {...S}><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 20a2 2 0 01-3.4 0" /></svg>
  ),
  chat: (
    <svg {...S}>
      <path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v10a1.5 1.5 0 01-1.5 1.5H9l-4 4V5.5z" />
      <circle cx="9" cy="11" r="1" fill="currentColor" /><circle cx="12.5" cy="11" r="1" fill="currentColor" />
      <circle cx="16" cy="11" r="1" fill="currentColor" />
    </svg>
  ),
  chevron: (
    <svg {...S} strokeWidth={2.2}><path d="M6 9l6 6 6-6" /></svg>
  ),
};
