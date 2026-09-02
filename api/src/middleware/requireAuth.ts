import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { auth } from '../firebase.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid Bearer token.',
        correlationId,
      },
    });
    return;
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Invalid token format.',
        correlationId,
      },
    });
    return;
  }

  try {
    // Cryptographically verify ID token with checkRevoked=true for immediate revocation enforcement
    const decodedToken = await auth.verifyIdToken(token, true);

    const role: 'user' | 'admin' = decodedToken.role === 'admin' ? 'admin' : 'user';

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role,
    };

    next();
  } catch (error: any) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      correlationId,
      event: 'AUTH_VERIFICATION_FAILED',
      errorMessage: error?.message,
      errorCode: error?.code,
    }));

    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token is invalid or has expired.',
        correlationId,
      },
    });
  }
};