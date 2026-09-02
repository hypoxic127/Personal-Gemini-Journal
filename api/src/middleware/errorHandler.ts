import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { AppError, isAppError } from '../lib/errors.js';

export type { AppError };

interface ErrorLike extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
  details?: Array<{ path: string; code: string }>;
}

export const errorHandler: ErrorRequestHandler = (
  err: ErrorLike,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  const operational = isAppError(err);
  const statusCode = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;
  const errorCode = err.code || (statusCode === 400 ? 'BAD_REQUEST' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');

  // Log detailed error server-side ONLY. NEVER leak stack traces or internal details to client.
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    correlationId,
    method: req.method,
    url: req.originalUrl,
    uid: req.user?.uid,
    statusCode,
    errorCode,
    operational,
    errorMessage: err.message,
    stack: err.stack,
  }));

  const genericMessage = statusCode === 400
    ? 'Invalid request payload.'
    : statusCode === 401
    ? 'Authentication required.'
    : statusCode === 403
    ? 'Access denied.'
    : statusCode === 404
    ? 'Resource not found.'
    : statusCode === 429
    ? 'Too many requests.'
    : statusCode === 503
    ? 'Service temporarily unavailable.'
    : 'An unexpected error occurred. Please try again later.';

  // Only an error we raised deliberately (AppError) may speak to the client in its own
  // words. An unexpected throw could carry a stack fragment, a path, or a key, so it is
  // always flattened to the generic message — the correlation id is the way back to it.
  const userFacingMessage = operational && statusCode < 500 ? err.message : genericMessage;

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: userFacingMessage,
      correlationId,
      // Field paths and issue codes only — never submitted values.
      ...(operational && err.details ? { details: err.details } : {}),
    },
  });
};
