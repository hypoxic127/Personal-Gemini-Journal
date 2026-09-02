import { ZodError } from 'zod';

/**
 * Operational errors — the ones we raised on purpose, with a message that is safe to show
 * a client. Everything else reaching the error handler is a bug or an unexpected failure
 * and is answered with a generic message plus a correlation id.
 *
 * Detail limits: an operational message describes what is wrong with *this request's own
 * payload*. It never names another user, another resource, or whether one exists — client
 * errors stay non-enumerating (AGENTS.md §Secure coding standards 5).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational = true as const;
  /** Field paths + issue codes only. Never field values — those may be journal content. */
  readonly details?: Array<{ path: string; code: string }>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Array<{ path: string; code: string }>
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details && details.length > 0) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (
  message = 'Invalid request payload.',
  details?: Array<{ path: string; code: string }>
) => new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Access denied.') => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found.') =>
  new AppError(404, 'NOT_FOUND', message);

export const serviceUnavailable = (message = 'Service temporarily unavailable.') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

/**
 * Turn a Zod failure into a 400 the client can act on without leaking anything.
 * Carries which fields failed and how, never what was sent.
 */
export const fromZodError = (error: ZodError, message = 'Invalid request payload.'): AppError =>
  badRequest(
    message,
    error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join('.') || '(root)',
      code: issue.code,
    }))
  );

export const isAppError = (err: unknown): err is AppError =>
  err instanceof AppError ||
  (typeof err === 'object' && err !== null && (err as AppError).isOperational === true);
