import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitOptions {
  capacity?: number;       // Max tokens in the bucket (burst capacity)
  refillRate?: number;     // Tokens added per second
  windowMs?: number;       // Window for reference / cleanup
  maxRequests?: number;
}

const buckets = new Map<string, TokenBucket>();

// Periodic cleanup of stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxIdleTime = 10 * 60 * 1000; // 10 minutes
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > maxIdleTime) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export const createRateLimiter = (options: RateLimitOptions = {}): RequestHandler => {
  const capacity = options.capacity ?? options.maxRequests ?? 30; // 30 requests burst default
  const refillRate =
    options.refillRate ??
    (options.maxRequests && options.windowMs
      ? options.maxRequests / (options.windowMs / 1000)
      : 1); // 1 token / sec (60 req/min)

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.user?.uid || req.ip || 'anonymous';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      buckets.set(key, bucket);
    } else {
      // Refill tokens based on elapsed time
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillRate);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      next();
    } else {
      const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / refillRate);
      res.setHeader('Retry-After', retryAfterSeconds);
      const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();

      res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: `Too many requests. Please wait ${retryAfterSeconds} seconds before retrying.`,
          correlationId,
        },
      });
    }
  };
};

// Default rate limiter for standard authenticated routes
export const rateLimit = createRateLimiter({
  capacity: 60,
  refillRate: 1, // 60 req/min
});

// Stricter rate limiter for AI / LLM calling routes (availability protection)
export const aiRateLimit = createRateLimiter({
  capacity: 10,
  refillRate: 0.2, // 1 req every 5s (~12 req/min)
});