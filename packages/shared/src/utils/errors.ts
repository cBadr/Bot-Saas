export class OrcaError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'OrcaError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class BinanceApiError extends OrcaError {
  constructor(message: string, public binanceCode?: number, details?: unknown) {
    super('BINANCE_API_ERROR', message, 502, { binanceCode, ...(details as object) });
    this.name = 'BinanceApiError';
  }
}

export class RateLimitError extends OrcaError {
  constructor(scope: string, retryAfterMs: number) {
    super('RATE_LIMIT_EXCEEDED', `Rate limit exceeded for ${scope}`, 429, { retryAfterMs });
    this.name = 'RateLimitError';
  }
}

export class InvalidOrderError extends OrcaError {
  constructor(message: string, details?: unknown) {
    super('INVALID_ORDER', message, 400, details);
    this.name = 'InvalidOrderError';
  }
}
