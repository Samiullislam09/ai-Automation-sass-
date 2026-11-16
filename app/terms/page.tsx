import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal/LegalPage";
import { BRAND } from "@/lib/brand";
import { PLANS } from "@/lib/plans";

export const metadata: Metadata = { title: "Terms & Conditions", alternates: { canonical: "/terms" }, description: `The terms for using ${BRAND.name}.` };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro={`These terms are the agreement between you and ${BRAND.name} for your use of ${BRAND.domain} and the ${BRAND.name} service. By creating an account or using the service you agree to them. If you use ${BRAND.name} for a company, you confirm you may accept these terms for it.`}
    >
      <section>
        <H2>1. The service</H2>
        <p>
          {BRAND.name} gives you an AI marketing team: it researches keywords, writes articles in your voice, publishes them to a site you connect, and can help you answer leads, including on WhatsApp. Some features are labelled &ldquo;coming soon&rdquo; and are not part of the service until they are released.
        </p>
      </section>

      <section>
        <H2>2. Your account</H2>
        <UL items={[
          "You must give accurate information and keep your password secret. You are responsible for what happens under your account.",
          "You must be at least 18 years old.",
          "Tell us at once if you think someone else has used your account.",
        ]} />
      </section>

      <section>
        <H2>3. You stay in control of what is published</H2>
        <p>
          The team prepares content and replies with AI. AI can make mistakes, so by default nothing goes out to the public until you approve it. If you turn on auto-publish, or let the assistant reply to messages on its own, you accept responsibility for what it publishes or sends on your behalf.
          Please read what you approve. We do not promise that content will rank, bring traffic or produce sales.
        </p>
      </section>

      <section>
        <H2>4. Acceptable use</H2>
        <p>You agree not to use {BRAND.name} to:</p>
        <UL items={[
          "break the law or the rights of others, or publish content that is unlawful, deceptive, hateful or infringing;",
          "send spam or unwanted messages, or contact people who have asked you to stop. You are responsible for having a lawful basis to contact anyone, and for following the rules of WhatsApp and of the countries you send to;",
          "pretend to be someone you are not, or invent reviews, testimonials or statistics;",
          "attempt to break, overload or reverse-engineer the service, or to access another customer's data.",
        ]} />
        <p className="mt-3">We may suspend an account that breaks these rules.</p>
      </section>

      <section>
        <H2>5. Your content and ours</H2>
        <p>
          You keep ownership of your website content, your business information and the articles and messages the team produces for you. You give us permission to process them as needed to run the service for you. {BRAND.name}&apos;s software, brand and design remain ours.
        </p>
      </section>

      <section>
        <H2>6. Plans and payment</H2>
        <p>
          There is a free plan and paid plans: {PLANS.starter.name} at ${PLANS.starter.price} a month and {PLANS.growth.name} at ${PLANS.growth.price} a month (prices in US dollars; taxes may apply). Each plan includes a monthly allowance of work, counted in tokens. Paid plans renew every month until you cancel. You can change or cancel your plan at any time from your account. See our <a className="text-[#5242d8] underline" href="/refund">Refund Policy</a> for refunds.
        </p>
      </section>

      <section>
        <H2>7. Third-party services</H2>
        <p>
          {BRAND.name} works with services you choose to connect, such as WordPress, Google and WhatsApp. Those services have their own terms, which you must follow, and we are not responsible for their availability or changes.
        </p>
      </section>

      <section>
        <H2>8. Availability</H2>
        <p>We work to keep the service running but cannot promise it will always be available or error-free. We may change or improve features over time.</p>
      </section>

      <section>
        <H2>9. Limits of our responsibility</H2>
        <p>
          The service is provided &ldquo;as is&rdquo;. To the extent the law allows, {BRAND.name} is not liable for indirect or consequential losses, lost profits or lost data, or for anything published or sent after your approval. Our total liability for any claim is limited to the amount you paid us in the three months before it. Nothing here limits liability that cannot be limited by law.
        </p>
      </section>

      <section>
        <H2>10. Ending the agreement</H2>
        <p>
          You can stop using {BRAND.name} and delete your account at any time. We may suspend or end your access if you break these terms or if we must by law. When an account ends we delete your data as described in the <a className="text-[#5242d8] underline" href="/privacy">Privacy Policy</a>.
        </p>
      </section>

      <section>
        <H2>11. Changes to these terms</H2>
        <p>If we change these terms in a way that matters, we will tell you before the change takes effect. If you keep using the service after that, you accept the new terms.</p>
      </section>

      <section>
        <H2>12. Contact</H2>
        <p>Write to <a className="text-[#5242d8] underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> for anything about these terms.</p>
      </section>
    </LegalPage>
  );
}
