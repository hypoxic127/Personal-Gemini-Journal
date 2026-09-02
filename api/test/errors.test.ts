import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { AppError, badRequest, fromZodError, isAppError } from '../src/lib/errors.js';

const runHandler = (err: unknown) => {
  const req = { headers: {}, method: 'POST', originalUrl: '/api/test' } as Request;
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

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  errorHandler(err as any, req, res, (() => {}) as NextFunction);
  consoleSpy.mockRestore();

  return { statusCode, jsonBody };
};

describe('AppError + errorHandler', () => {
  it('POS-ERR-01: an operational 400 keeps its message and field-level details', () => {
    const schema = z.object({ displayName: z.string().max(3) }).strict();
    const parsed = schema.safeParse({ displayName: 'far too long', extra: 1 });
    expect(parsed.success).toBe(false);

    const { statusCode, jsonBody } = runHandler(
      fromZodError((parsed as { error: z.ZodError }).error, 'Invalid user sync payload.')
    );

    expect(statusCode).toBe(400);
    expect(jsonBody.error.code).toBe('BAD_REQUEST');
    expect(jsonBody.error.message).toBe('Invalid user sync payload.');
    expect(jsonBody.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'displayName' })])
    );
    expect(jsonBody.error.correlationId).toBeTruthy();
  });

  it('NEG-ERR-01: details carry field paths and issue codes, never submitted values', () => {
    const schema = z.object({ photoURL: z.string().url() });
    const parsed = schema.safeParse({ photoURL: 'super-secret-not-a-url' });
    const { jsonBody } = runHandler(fromZodError((parsed as { error: z.ZodError }).error));

    expect(JSON.stringify(jsonBody)).not.toContain('super-secret-not-a-url');
  });

  it('NEG-ERR-02: an unexpected throw is flattened to a generic message with no stack', () => {
    const leaky = new Error('ENOENT: /app/api/dist/secrets/service-account.json missing');
    const { statusCode, jsonBody } = runHandler(leaky);

    expect(statusCode).toBe(500);
    expect(jsonBody.error.message).toBe('An unexpected error occurred. Please try again later.');
    expect(JSON.stringify(jsonBody)).not.toContain('service-account');
    expect(jsonBody.error.stack).toBeUndefined();
  });

  it('NEG-ERR-03: a non-operational error carrying a 4xx statusCode still gets a generic message', () => {
    const forged = Object.assign(new Error('user 12345 not found in tenant acme'), {
      statusCode: 404,
    });
    const { statusCode, jsonBody } = runHandler(forged);

    expect(statusCode).toBe(404);
    expect(jsonBody.error.message).toBe('Resource not found.');
    expect(JSON.stringify(jsonBody)).not.toContain('acme');
  });

  it('POS-ERR-02: isAppError recognises the factory output', () => {
    expect(isAppError(badRequest())).toBe(true);
    expect(isAppError(new AppError(403, 'FORBIDDEN', 'Access denied.'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
