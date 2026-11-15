import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CATALOG, type ApiErrorBody } from '@hongbao/shared';
import { AppError } from './app-error.js';

/** Every error leaves the API as { error: { code, message, ...extra } }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status: number;
    let body: ApiErrorBody;
    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...err.extra } };
    } else if (err instanceof HttpException && err.getStatus() === 404) {
      status = 404;
      body = { error: { code: 'NOT_FOUND', message: ERROR_CATALOG.NOT_FOUND.message } };
    } else if (err instanceof HttpException && err.getStatus() === 400) {
      status = 400; // e.g. malformed JSON
      body = { error: { code: 'INVALID_REQUEST', message: ERROR_CATALOG.INVALID_REQUEST.message } };
    } else {
      this.log.error(err instanceof Error ? err.stack : String(err));
      status = 500;
      body = { error: { code: 'CHAIN_UNAVAILABLE', message: 'Something went wrong on our side — please try again.' } };
    }
    res.status(status).json(body);
  }
}
