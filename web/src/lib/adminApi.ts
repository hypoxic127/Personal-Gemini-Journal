import { api, ApiError } from './api';
import type {
  AdminStatsResponse,
  AdminUsersResponse,
  AdminUserSummary,
  AdminUserItem,
  UserRole,
} from '@journal/shared';

export type {
  AdminStatsResponse,
  AdminUsersResponse,
  AdminUserSummary,
  AdminUserItem,
  UserRole,
};

export interface ListUsersParams {
  limit?: number;
  cursor?: string | null;
}

export interface SetUserRoleResult {
  ok: boolean;
  uid: string;
  role: UserRole;
}

export const adminApi = {
  /**
   * Fetches de-identified population-level stats and daily trends.
   * Small samples (< 5 active users) will return `suppressed: true` with null distribution.
   */
  getStats: async (): Promise<AdminStatsResponse> => {
    return api.get<AdminStatsResponse>('/api/admin/stats');
  },

  /**
   * Fetches paginated user directory metadata (strict zero content guarantee).
   */
  listUsers: async (params?: ListUsersParams): Promise<AdminUsersResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.limit) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.cursor) {
      searchParams.set('cursor', params.cursor);
    }
    const queryString = searchParams.toString();
    const url = queryString ? `/api/admin/users?${queryString}` : '/api/admin/users';
    return api.get<AdminUsersResponse>(url);
  },

  /**
   * Updates a user's role claim.
   * Triggers immediate token revocation for the target user.
   */
  setUserRole: async (uid: string, role: UserRole): Promise<SetUserRoleResult> => {
    return api.post<SetUserRoleResult>(`/api/admin/users/${encodeURIComponent(uid)}/role`, {
      role,
    });
  },
};

/**
 * Maps API / network errors to clear, safe user-facing error messages.
 */
export function describeError(err: unknown, fallbackMessage = 'An unexpected error occurred.'): string {
  if (err instanceof ApiError) {
    if (err.code === 'CANNOT_DEMOTE_SELF' || err.status === 400 && err.message.includes('demote')) {
      return 'Administrators cannot demote their own account.';
    }
    if (err.status === 403 || err.code === 'FORBIDDEN') {
      return 'Access denied. Administrative privileges are required.';
    }
    if (err.status === 429 || err.code === 'RATE_LIMITED') {
      return 'Too many requests. Please wait a moment before trying again.';
    }
    if (err.status === 401 || err.code === 'UNAUTHORIZED') {
      return 'Your session has expired. Please sign in again.';
    }
    return err.message || fallbackMessage;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallbackMessage;
}
