import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../src/middleware/requireAuth.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

describe('requireAuth Middleware', () => {
  it('rejects requests without Authorization header (401)', async () => {
    const req = { headers: {} } as Request;
    let statusCode = 0;
    let jsonBody: any = null;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonBody = data;
        return res;
      },
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(statusCode).toBe(401);
    expect(jsonBody?.error?.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with malformed Bearer token (401)', async () => {
    const req = { headers: { authorization: 'Basic 12345' } } as Request;
    let statusCode = 0;
    let jsonBody: any = null;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonBody = data;
        return res;
      },
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(statusCode).toBe(401);
    expect(jsonBody?.error?.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('rateLimit Middleware', () => {
  it('enforces token bucket rate limits and returns 429 with Retry-After header', () => {
    const limiter = createRateLimiter({ capacity: 2, refillRate: 0.1 });
    const req = { user: { uid: 'test-user-rate' }, headers: {} } as unknown as Request;
    let statusCode = 0;
    let retryAfterHeader = 0;
    let jsonBody: any = null;

    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      setHeader: (name: string, value: any) => {
        if (name === 'Retry-After') retryAfterHeader = value;
        return res;
      },
      json: (data: any) => {
        jsonBody = data;
        return res;
      },
    } as unknown as Response;

    const next = vi.fn();

    // 1st request -> OK
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // 2nd request -> OK
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    // 3rd request -> Limit exceeded (429)
    limiter(req, res, next);
    expect(statusCode).toBe(429);
    expect(retryAfterHeader).toBeGreaterThan(0);
    expect(jsonBody?.error?.code).toBe('TOO_MANY_REQUESTS');
    expect(next).toHaveBeenCalledTimes(2); // not called for 3rd
  });
});