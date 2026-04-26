import { createHmac } from 'node:crypto';
import { request } from 'undici';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';

const log = createLogger('PAYMENT', { module: 'CoinPayments' });

/**
 * Minimal CoinPayments.net API client.
 * Uses HMAC-SHA512 with the private key.
 * Docs: https://www.coinpayments.net/apidoc
 */
export interface CreateTxnInput {
  amount: number;            // amount in `currency1`
  currency1: string;         // source currency, e.g. "USD"
  currency2: string;         // crypto to receive, e.g. "USDT.TRC20"
  buyerEmail: string;
  itemName?: string;
  custom?: string;           // we put userId:planId:subscriptionPaymentId here
  ipnUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateTxnResult {
  txn_id: string;
  status_url: string;
  qrcode_url: string;
  checkout_url: string;
  amount: string;
  address: string;
  timeout: number;
}

export class CoinPaymentsClient {
  async createTransaction(input: CreateTxnInput): Promise<CreateTxnResult> {
    const body: Record<string, string | number> = {
      version: 1,
      key: env.COINPAYMENTS_PUBLIC_KEY,
      cmd: 'create_transaction',
      amount: input.amount,
      currency1: input.currency1,
      currency2: input.currency2,
      buyer_email: input.buyerEmail,
      ipn_url: input.ipnUrl ?? env.COINPAYMENTS_IPN_URL,
      ...(input.itemName ? { item_name: input.itemName } : {}),
      ...(input.custom ? { custom: input.custom } : {}),
      ...(input.successUrl ? { success_url: input.successUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
    };

    const result = await this.call<CreateTxnResult>(body);
    log.info('Transaction created', { txnId: result.txn_id, amount: input.amount });
    return result;
  }

  private async call<T>(body: Record<string, string | number>): Promise<T> {
    if (!env.COINPAYMENTS_PUBLIC_KEY || !env.COINPAYMENTS_PRIVATE_KEY) {
      throw new Error('CoinPayments credentials not configured');
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) params.set(k, String(v));
    const formBody = params.toString();

    const hmac = createHmac('sha512', env.COINPAYMENTS_PRIVATE_KEY).update(formBody).digest('hex');

    const res = await request('https://www.coinpayments.net/api.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        HMAC: hmac,
      },
      body: formBody,
    });
    const json = (await res.body.json()) as { error: string; result?: T };
    if (json.error !== 'ok') {
      throw new Error(`CoinPayments error: ${json.error}`);
    }
    return json.result as T;
  }

  /** Verify IPN signature using HMAC-SHA512 over raw POST body, with IPN secret. */
  verifyIpnSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature || !env.COINPAYMENTS_IPN_SECRET) return false;
    const expected = createHmac('sha512', env.COINPAYMENTS_IPN_SECRET).update(rawBody).digest('hex');
    return expected === signature;
  }
}

export const coinpaymentsClient = new CoinPaymentsClient();
