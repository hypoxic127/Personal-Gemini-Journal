import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { randomUUID } from 'crypto';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
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
    statusCode,
    errorCode,
    errorMessage: err.message,
    stack: err.stack,
  }));

  const userFacingMessage = statusCode === 400
    ? (err.isOperational ? err.message : 'Invalid request payload.')
    : statusCode === 401
    ? 'Authentication required.'
    : statusCode === 403
    ? 'Access denied.'
    : statusCode === 404
    ? 'Resource not found.'
    : 'An unexpected error occurred. Please try again later.';

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: userFacingMessage,
      correlationId,
    },
  });
};