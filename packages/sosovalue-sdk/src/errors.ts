export class SoSoValueAPIError extends Error {
  override name: string = 'SoSoValueAPIError';
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class SoSoValueRateLimitError extends SoSoValueAPIError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'SoSoValueRateLimitError';
  }
}

export class SoSoValueValidationError extends Error {
  override name: string = 'SoSoValueValidationError';
  readonly validationError: unknown;
  readonly rawResponse: unknown;

  constructor(message: string, validationError: unknown, rawResponse: unknown) {
    super(message);
    this.validationError = validationError;
    this.rawResponse = rawResponse;
  }
}
