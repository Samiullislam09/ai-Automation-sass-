import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" }, description: `How ${BRAND.name} collects, uses and protects your information.` };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`${BRAND.name} is an AI marketing team for small business. This policy explains what information we collect when you use ${BRAND.name} at ${BRAND.domain}, why we collect it, who we share it with, and the choices you have. We do not sell your personal information.`}
    >
      <section>
        <H2>1. Information we collect</H2>
        <UL items={[
          <><b>Account details.</b> Your email address, your name if you give it, your password (stored only as a secure hash by our sign-in provider) and the plan you are on. If you sign in with Google we receive your name and email address from Google.</>,
          <><b>Your website and business details.</b> The address of your website, the public pages we read from it, and the answers you give during setup. We use these to build your Site Brain, the team&apos;s memory of your business.</>,
          <><b>Content and activity.</b> Keywords, articles, drafts, images, approvals and rejections, schedules, and a log of what the team did and who approved it.</>,
          <><b>Connected accounts.</b> When you connect a service (WordPress, Google, WhatsApp) we store what is needed to act on your behalf, such as an access token or a connection session. Connected accounts are optional and you can disconnect them at any time.</>,
          <><b>Messages with your leads.</b> If you connect WhatsApp, we process the messages between your number and your leads so the assistant can draft and send replies for you and keep the conversation history in your account.</>,
          <><b>Technical data.</b> Basic logs (such as your IP address, browser type and the pages you visit) and the cookies described below.</>,
        ]} />
      </section>

      <section>
        <H2>2. How we use it</H2>
        <UL items={[
          "To provide the service: research keywords, write and publish content, reply to leads, and show you what happened.",
          "To keep your account secure, prevent abuse and fix problems.",
          "To bill you for a paid plan and to answer your support requests.",
          "To improve the product, using aggregated usage information.",
          "To send you service messages (for example a daily report or a security notice). You can turn optional messages off.",
        ]} />
      </section>

      <section>
        <H2>3. AI processing</H2>
        <p>
          To write content and replies, the text needed for the task (for example a keyword, a page from your site, or a customer message) is sent to third-party AI model providers. We send only what the task needs. We do not allow these providers to use
          your content to advertise to you. Everything the team prepares for public release waits for your approval first, unless you turn on auto-publish for a schedule.
        </p>
      </section>

      <section>
        <H2>4. Who we share information with</H2>
        <p>We share information only with the services that help us run {BRAND.name}, and only as needed:</p>
        <UL items={[
          "Hosting and database providers, which store your account and content securely.",
          "AI model providers, as described above.",
          "Google, when you choose to connect Google sign-in, Calendar, Search Console or Analytics.",
          "WordPress or another site you connect, when you approve something to be published there.",
          "WhatsApp, through the number you link, when the assistant sends a message you have allowed.",
          "A payment provider, if you buy a paid plan, to process the payment.",
          "Authorities, if the law requires it.",
        ]} />
      </section>

      <section>
        <H2>5. Google user data</H2>
        <p>
          If you connect your Google account, we request only the access needed for the feature you turn on: your basic profile to sign you in, read-only access to Search Console and Analytics reports, and Calendar access to find free times and create Google Meet events for calls with your leads.
          We use this data only to provide those features to you. {BRAND.name}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-[#5242d8] underline" href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">Google API Services User Data Policy</a>, including the Limited Use requirements. You can disconnect Google in{" "}
          {BRAND.name} at any time and remove our access at{" "}
          <a className="text-[#5242d8] underline" href="https://myaccount.google.com/permissions" rel="noopener noreferrer" target="_blank">myaccount.google.com/permissions</a>.
        </p>
      </section>

      <section>
        <H2>6. Cookies and local storage</H2>
        <p>
          We use cookies that are needed to keep you signed in and secure, and your browser&apos;s local storage to remember settings such as the theme and whether the sidebar is compact. We do not use advertising cookies and we do not track you across other websites.
        </p>
      </section>

      <section>
        <H2>7. How long we keep it</H2>
        <p>
          We keep your information while your account is active. If you delete your account, or ask us to, we delete your account data and content within a reasonable period, except where we must keep something to meet a legal duty or settle a dispute.
        </p>
      </section>

      <section>
        <H2>8. Security</H2>
        <p>
          We protect your information with access controls, encryption in transit and per-account separation of data. Sensitive tokens for connected services are stored encrypted. No system is perfectly secure, so please use a strong, unique password and tell us straight away if you think your account was accessed without your permission.
        </p>
      </section>

      <section>
        <H2>9. Your choices and rights</H2>
        <p>
          You can ask us to access, correct, export or delete the information we hold about you, to stop optional messages, or to close your account. Depending on where you live, you may also have the right to object to or restrict certain processing, and to complain to your local data-protection authority.
          Write to <a className="text-[#5242d8] underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> and we will reply within 30 days.
        </p>
      </section>

      <section>
        <H2>10. Messages to your leads</H2>
        <p>
          When you use {BRAND.name} to contact people, you are responsible for having a lawful reason to do so, and for honouring anyone who asks you to stop. The assistant treats a request to stop as final and does not message that person again.
        </p>
      </section>

      <section>
        <H2>11. Children</H2>
        <p>{BRAND.name} is for businesses and is not directed at anyone under 18. We do not knowingly collect information from children.</p>
      </section>

      <section>
        <H2>12. Changes to this policy</H2>
        <p>If we change this policy in a way that matters, we will tell you in the product or by email before the change takes effect. The date at the top shows when it was last updated.</p>
      </section>
    </LegalPage>
  );
}
