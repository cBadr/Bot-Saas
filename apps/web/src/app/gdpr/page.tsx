import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'GDPR Rights — Orca' };

export default function GdprPage() {
  return (
    <LegalLayout title="GDPR Rights" lastUpdated="2026-05-02">
      <p>
        If you are a resident of the European Economic Area, the United Kingdom, or any
        jurisdiction with comparable privacy law (CCPA, PDPA, etc.), you have the rights below.
        Orca treats them as universal: anyone can request them regardless of location.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li><strong>Right of access</strong> — request a copy of all personal data we hold on you.</li>
        <li><strong>Right of rectification</strong> — correct inaccurate or incomplete data via Settings → Profile.</li>
        <li><strong>Right of erasure</strong> — delete your account and all associated data within 30 days.</li>
        <li><strong>Right of portability</strong> — receive your trading history (orders, trades, P&amp;L) as JSON or CSV.</li>
        <li><strong>Right to restrict processing</strong> — pause notifications or stop bots without deleting the account.</li>
        <li><strong>Right to object</strong> — object to processing for analytics or marketing.</li>
        <li><strong>Right to withdraw consent</strong> — revoke notification opt-ins at any time from Settings → Notifications.</li>
        <li><strong>Right not to be subject to automated decision-making</strong> — Orca does not make legally significant automated decisions about you.</li>
      </ul>

      <h2>How to exercise them</h2>
      <p>
        Most rights can be exercised directly from your account:
      </p>
      <ul>
        <li><strong>Export:</strong> Settings → Profile → &quot;Export my data&quot;. Generates a JSON archive of your account, bots, orders, trades, and notification logs.</li>
        <li><strong>Deletion:</strong> Settings → Profile → &quot;Delete my account&quot;. All bots are stopped, encrypted API keys are erased, and all personal data is purged within 30 days.</li>
        <li><strong>Manual requests:</strong> email <a href="mailto:privacy@orca.local">privacy@orca.local</a> with your registered email address. We respond within 30 days.</li>
      </ul>

      <h2>Data we are legally required to retain</h2>
      <p>
        Even after account deletion, we may retain anonymized aggregates and certain billing records
        where required by tax law (typically 5–7 years depending on jurisdiction). These records do
        not contain identifiable trading activity.
      </p>

      <h2>Lodging a complaint</h2>
      <p>
        If you believe we have not handled your data properly, you have the right to lodge a complaint
        with your local data protection authority. We strongly encourage you to contact us first so
        we can resolve the issue directly.
      </p>

      <h2>Data Protection Officer</h2>
      <p>
        Contact: <a href="mailto:dpo@orca.local">dpo@orca.local</a>.
      </p>
    </LegalLayout>
  );
}
