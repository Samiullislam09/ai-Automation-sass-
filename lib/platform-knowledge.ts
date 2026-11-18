/** What this product does beyond the agent actions in the brain's registry — the one place the chat reads it from.
 *
 *  WHY. The "what can you do" text came only from the agent manifests (write an article, find keywords, find leads…). WhatsApp, meetings, reminders
 *  and the daily summary are a separate subsystem that never appears there, so asked "can you talk to my leads?" the assistant answered "no" about the
 *  product's biggest feature (client chat, 2026-11-18). This block is attached to the chat's system prompt, to the router's prompt and to the
 *  capabilities text, so the same truth reaches every place a model decides what to say or which tool to call.
 *
 *  It describes WHAT EXISTS; whether each part is switched on for THIS customer is read live with the lookup_autopilot tool, never assumed here. */
export const PLATFORM_KNOWLEDGE = [
  "THE LEAD CHAIN — the product's biggest feature, and it is real and working:",
  "- The team FINDS leads (businesses that fit the customer's ideal buyer) on a daily schedule and files them in the Leads page.",
  "- It TALKS TO THEM ON WHATSAPP through the customer's own linked number: a first message (after a natural pause, inside sending hours), follow-ups after 48 hours, 5 days and 7 days of silence, and it ANSWERS every reply in the lead's own language, fast. It hands anything it cannot settle to a person and tells the owner.",
  "- It BOOKS CALLS: when a lead wants one it offers real free times from Google Calendar and creates the Google Meet link (or sends the owner's booking link), then sends reminders 24 hours and 1 hour before. Anyone who asks to stop is never messaged again.",
  "- The owner and team get WhatsApp alerts (a call wanted, a hot lead, someone who needs a person) and a daily summary. Email outreach is planned, not live yet.",
  "- So when asked whether you can talk to, message, follow up with or book calls with leads: YES, through WhatsApp. Never say you cannot. To say what is switched on for this customer right now, or what is missing, use the autopilot lookup.",
  "- All of it runs as one AUTOPILOT with a single switch, on the Autopilot page (sidebar) — and the customer can also just tell you: turn it on or off, how many leads a day, at what time, the sending hours, follow-ups, reminders, the daily summary. You can do those changes yourself with the autopilot tool; questions about its state are lookups.",
  "TO ANSWER FROM DATA, NEVER FROM MEMORY: a lead's conversation or history = the lead-conversation lookup; how many leads / how many have WhatsApp / how many replied = the lead-stats lookup; keyword results already found = the keywords lookup; whether the chain is running = the autopilot lookup; WHO was messaged / found / replied in a period (today, 24 hours, a week), the last message sent, and a summary of those messages = the outreach-activity lookup; what is connected (WhatsApp, Google, WordPress, team numbers) = the connections lookup. Never answer \"I do not have that\" without calling the lookup that has it.",
].join("\n");
