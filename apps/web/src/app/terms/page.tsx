import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Terms of Service — Orca' };

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="2026-05-02">
      <p>
        By creating an Orca account or using the service you agree to these terms. If you do not
        agree, do not use Orca.
      </p>

      <h2>1. The service</h2>
      <p>
        Orca is a software tool that places orders on cryptocurrency exchanges on your behalf
        according to strategies you configure. Orca does NOT take custody of your funds. Funds
        remain on the exchange under your account at all times.
      </p>

      <h2>2. Eligibility</h2>
      <ul>
        <li>You must be at least 18 years old.</li>
        <li>You must not be a resident of, or operating from, a jurisdiction where automated cryptocurrency trading is prohibited.</li>
        <li>You are responsible for complying with your local tax and regulatory obligations.</li>
      </ul>

      <h2>3. Risk disclaimer</h2>
      <p>
        <strong>Cryptocurrency trading is high risk.</strong> Bot strategies can and do lose money.
        Past performance, backtest results, and marketplace ratings are not guarantees of future
        results. Orca provides software, not investment advice. You bear sole responsibility for
        every trade placed through your account, including those triggered by automated strategies
        you start.
      </p>

      <h2>4. Subscriptions and refunds</h2>
      <ul>
        <li>Paid plans are billed in advance via CoinPayments (cryptocurrency) or other supported processors.</li>
        <li>The 14-day free trial requires no payment method and converts to no plan unless you actively subscribe.</li>
        <li>Subscriptions are non-refundable except where required by law. You may cancel at any time; access continues until the end of the current billing period.</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Orca for market manipulation, wash trading, or spoofing.</li>
        <li>Attempt to bypass rate limits, share account credentials, or run multiple accounts to circumvent plan limits.</li>
        <li>Reverse engineer, scrape, or interfere with the service.</li>
        <li>Upload malicious node/strategy definitions that target other users or external systems.</li>
      </ul>

      <h2>6. Marketplace and copy trading</h2>
      <p>
        Strategies published on the marketplace are user-generated content. Orca does not endorse,
        verify, or warrant the performance of any third-party strategy. Subscribers to a copy-trading
        strategy assume full risk; the publisher does not act as a financial adviser.
      </p>

      <h2>7. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these terms, abuse the service, or pose
        security risks. You may close your account at any time from Settings.
      </p>

      <h2>8. Liability</h2>
      <p>
        Orca is provided &quot;as is&quot; without warranty of any kind. To the fullest extent
        permitted by law, our liability for any claim is capped at the fees you paid us in the
        12 months preceding the claim. We are not liable for trading losses, exchange downtime,
        or third-party failures.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms occasionally. Material changes will be announced in-app with at
        least 14 days&apos; notice. Continued use after the effective date constitutes acceptance.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions: <a href="mailto:legal@orca.local">legal@orca.local</a>.
      </p>
    </LegalLayout>
  );
}
