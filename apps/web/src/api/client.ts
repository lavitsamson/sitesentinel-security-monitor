import {
  PROBLEM_CONTENT_TYPE,
  healthReadySchema,
  problemDetailsSchema,
  type HealthReady,
  type ProblemDetails,
} from '@sitesentinel/shared';
import type { z } from 'zod';

/** Thrown for any non-2xx response; carries the RFC 9457 body when the API sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: ProblemDetails,
    /** RFC 9457 extension members, e.g. `attempts` on a failed verification. Unvalidated. */
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

const API_BASE = '/api/v1';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** The API's CSRF check: cross-origin pages can't send custom headers. */
const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' };

async function toApiError(res: Response): Promise<ApiError> {
  if (res.headers.get('content-type')?.startsWith(PROBLEM_CONTENT_TYPE)) {
    const body: unknown = await res.json().catch(() => null);
    const parsed = problemDetailsSchema.safeParse(body);
    if (!parsed.success) return new ApiError(res.status);
    // The schema strips unknown keys; keep the rest as extensions for callers that expect them.
    const extensions = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(([key]) => !(key in parsed.data)),
    );
    return new ApiError(res.status, parsed.data, extensions);
  }
  return new ApiError(res.status);
}

export async function apiGet(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    ...init,
  });
  if (!res.ok && res.headers.get('content-type')?.startsWith(PROBLEM_CONTENT_TYPE)) {
    throw await toApiError(res);
  }
  return res;
}

/**
 * Readiness is the one endpoint where 503 is an expected answer, not an error:
 * its body still describes which dependency is down.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<HealthReady> {
  const res = await apiGet('/health/ready', { signal });
  if (!res.ok && res.status !== 503) {
    throw new ApiError(res.status);
  }
  return healthReadySchema.parse(await res.json());
}

// --- Authenticated requests ---------------------------------------------------

let sessionExpiredHandler: (() => void) | undefined;

/** Called when the session can't be refreshed, e.g. to send the user to sign in. */
export function onSessionExpired(handler: (() => void) | undefined): void {
  sessionExpiredHandler = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotates the session cookies. Single-flight: when several requests hit 401 at
 * once they share one refresh, because a second refresh with the same (now
 * rotated) token would look like token theft and end the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: CSRF_HEADERS,
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export interface RequestOptions<T> {
  body?: unknown;
  /** Validates and types the JSON response. Omit for empty (204) responses. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  /** On 401, refresh the session once and retry. Off for sign-in style endpoints. */
  retryOnUnauthorized?: boolean;
}

export async function apiRequest<T = void>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  { body, schema, signal, retryOnUnauthorized = true }: RequestOptions<T> = {},
): Promise<T> {
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(MUTATING_METHODS.has(method) && CSRF_HEADERS),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  let res = await send();
  if (res.status === 401 && retryOnUnauthorized) {
    if (await refreshSession()) {
      res = await send();
    } else {
      sessionExpiredHandler?.();
    }
  }
  if (!res.ok) throw await toApiError(res);
  if (!schema || res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}
