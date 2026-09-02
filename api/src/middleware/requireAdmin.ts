import { Request, Response, NextFunction, RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';

/**
 * Server-side RBAC middleware asserting that the caller holds the 'admin' custom claim.
 * Must always be mounted downstream of `requireAuth`.
 *
 * Precedence:
 * 1. Checks `req.user.role === 'admin'` extracted exclusively from cryptographically verified token claims.
 * 2. If `req.user` is missing or `role !== 'admin'`, halts request with standard 403 FORBIDDEN.
 */
export const requireAdmin: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user || req.user.role !== 'admin') {
    next(forbidden('Admin access required.'));
    return;
  }

  next();
};

export default requireAdmin;
