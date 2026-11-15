// Throw AppError anywhere; the filter turns it into the catalog's HTTP status + human message.
import { ERROR_CATALOG, type ErrorCode } from '@hongbao/shared';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(ERROR_CATALOG[code].message);
  }
  get status() {
    return ERROR_CATALOG[this.code].http;
  }
}
