import { getFirebaseServices } from './firebase';

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
    correlationId?: string;
  };
}

export class ApiError extends Error {
  code: string;
  correlationId?: string;
  status: number;

  constructor(status: number, message: string, code = 'API_ERROR', correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  // Add content-type default
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach Firebase ID token if user is signed in
  const { auth } = getFirebaseServices();
  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
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

  if (!response.ok) {
    const errorObj = typeof result === 'object' && result?.error ? result.error : null;
    throw new ApiError(
      response.status,
      errorObj?.message || `Request failed with status ${response.status}`,
      errorObj?.code || 'REQUEST_FAILED',
      errorObj?.correlationId
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