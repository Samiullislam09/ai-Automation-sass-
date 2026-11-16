import type { Metadata } from "next";
import { LegalPage, H2, UL } from "@/components/legal/LegalPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Refund Policy", alternates: { canonical: "/refund" }, description: `How cancellations and refunds work at ${BRAND.name}.` };

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro={`This page explains how cancelling and refunds work at ${BRAND.name}. We want it to be simple and fair.`}
    >
      <section>
        <H2>1. The Free plan</H2>
        <p>The Free plan costs nothing and needs no card, so there is nothing to refund. It is the best way to see whether {BRAND.name} suits you before you pay.</p>
      </section>

      <section>
        <H2>2. Cancelling a paid plan</H2>
        <UL items={[
          "You can cancel at any time from your account. There is no cancellation fee.",
          "Cancelling stops the next renewal. You keep your paid plan until the end of the period you already paid for.",
          "Everything the team wrote for you stays yours, on any plan.",
        ]} />
      </section>

      <section>
        <H2>3. Refunds</H2>
        <p>Payments are for a monthly period of service, and the work in that period is done as you use it, so we do not refund a period that has started. We will refund you when:</p>
        <UL items={[
          "you were charged by mistake, or charged twice for the same period;",
          "you were charged after you cancelled, because of a problem on our side;",
          "the law where you live gives you a right to a refund, such as a statutory cooling-off period.",
        ]} />
      </section>

      <section>
        <H2>4. How to ask</H2>
        <p>
          Write to <a className="text-[#5242d8] underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> from the email on your account, with the date and amount of the payment. We reply within 5 working days. An approved refund goes back to the original payment method, and your bank may take a few more days to show it.
        </p>
      </section>
    </LegalPage>
  );
}
