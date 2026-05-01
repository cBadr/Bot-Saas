import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Privacy Policy — Orca' };

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="2026-05-02">
      <p>
        Orca (&quot;we&quot;, &quot;us&quot;) operates a crypto trading automation platform. This policy
        explains what we collect, how we use it, and your rights.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li><strong>Account:</strong> email, password (hashed with Argon2), full name, optional avatar URL.</li>
        <li><strong>Authentication:</strong> session tokens, IP address, last-login timestamp, optional 2FA secret.</li>
        <li><strong>Exchange API keys:</strong> Binance API key + secret, encrypted at rest with AES-256-GCM. We never request withdrawal permissions.</li>
        <li><strong>Trading data:</strong> orders, trades, bot state, P&amp;L history, audit events. Stored to render your dashboard and compute reports.</li>
        <li><strong>Notification routing:</strong> Telegram chat ID, Discord webhook URL, push subscription endpoints — only what you provide.</li>
        <li><strong>Operational logs:</strong> error traces (Sentry), API call counters. Personal data is redacted (passwords, tokens, secrets).</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To execute the bots you create on the exchange of your choice.</li>
        <li>To send you the notifications you opted into.</li>
        <li>To bill subscriptions and process crypto payments via CoinPayments.</li>
        <li>To prevent abuse, fraud, and to keep the service running (rate limits, kill switch).</li>
      </ul>

      <h2>3. What we do NOT do</h2>
      <ul>
        <li>We do not sell or rent your personal data.</li>
        <li>We do not place trades using your funds without your explicit bot configuration.</li>
        <li>We do not store your exchange API secret in plaintext, ever.</li>
        <li>We do not share your trading history with other users (unless you publish a strategy on the marketplace).</li>
      </ul>

      <h2>4. Third-party processors</h2>
      <ul>
        <li><strong>Binance</strong> — exchange execution.</li>
        <li><strong>CoinPayments</strong> — crypto subscription billing.</li>
        <li><strong>Resend</strong> — transactional email delivery.</li>
        <li><strong>Telegram, Discord, browser push services</strong> — notification delivery (only when you enable them).</li>
        <li><strong>Sentry</strong> — error tracking (PII redacted).</li>
      </ul>

      <h2>5. Retention</h2>
      <p>
        We keep your trading history while your account is active. Logs are kept for a maximum of 90 days.
        On account deletion, all personal data is purged within 30 days, except where law requires retention.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You may request export or deletion of your data at any time — see <a href="/gdpr">GDPR</a>.
        For questions, contact <a href="mailto:privacy@orca.local">privacy@orca.local</a>.
      </p>
    </LegalLayout>
  );
}
