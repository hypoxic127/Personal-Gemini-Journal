import { getFirebaseServices } from './firebase';

/**
 * A 401 means the server rejected the token, not that the request was malformed. Two things
 * cause it: a token that has simply aged out (recoverable — force-refresh and retry once),
 * and a session the server has actively invalidated, e.g. revokeRefreshTokens() after a role
 * change, which requireAuth catches via verifyIdToken(token, true) (not recoverable — the
 * user has to sign in again). We try the recoverable case exactly once, then hand off to the
 * auth layer so the UI can say "sign in again" instead of showing a generic failure.
 */
type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null): void => {
  unauthorizedHandler = handler;
};

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
    correlationId?: string;
    /** Field paths + issue codes from server-side Zod validation. Never submitted values. */
    details?: Array<{ path: string; code: string }>;
  };
}

interface RequestAttempt {
  forceTokenRefresh?: boolean;
  allowRetry?: boolean;
}

export class ApiError extends Error {
  code: string;
  correlationId?: string;
  status: number;
  details?: Array<{ path: string; code: string }>;

  constructor(
    status: number,
    message: string,
    code = 'API_ERROR',
    correlationId?: string,
    details?: Array<{ path: string; code: string }>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  { forceTokenRefresh = false, allowRetry = true }: RequestAttempt = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  // Add content-type default
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach Firebase ID token if user is signed in
  const { auth } = getFirebaseServices();
  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken(forceTokenRefresh);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch (e) {
      console.warn('Failed to retrieve Firebase ID token:', e);
    }
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const result: ApiResponse<T> = isJson ? await response.json() : await response.text();

  if (response.status === 401) {
    // A stale-but-renewable token: refresh once and replay the same request. The body is a
    // string or FormData, so it is safe to send again.
    if (allowRetry && auth?.currentUser) {
      return request<T>(endpoint, options, { forceTokenRefresh: true, allowRetry: false });
    }

    // Still rejected after a fresh token — the session is genuinely over.
    unauthorizedHandler?.();
    const errorObj = typeof result === 'object' && result?.error ? result.error : null;
    throw new ApiError(401, SESSION_EXPIRED_MESSAGE, 'UNAUTHORIZED', errorObj?.correlationId);
  }

  if (!response.ok) {
    const errorObj = typeof result === 'object' && result?.error ? result.error : null;
    throw new ApiError(
      response.status,
      errorObj?.message || `Request failed with status ${response.status}`,
      errorObj?.code || 'REQUEST_FAILED',
      errorObj?.correlationId,
      errorObj?.details
    );
  }

  return (typeof result === 'object' && 'data' in result ? result.data : result) as T;
}

export const api = {
  get: <T>(url: string, options?: RequestInit) => request<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, body?: any, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body || {}),
    }),
  put: <T>(url: string, body?: any, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body || {}),
    }),
  delete: <T>(url: string, options?: RequestInit) => request<T>(url, { ...options, method: 'DELETE' }),
};