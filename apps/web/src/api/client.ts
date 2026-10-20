import {
  PROBLEM_CONTENT_TYPE,
  healthReadySchema,
  problemDetailsSchema,
  type HealthReady,
  type ProblemDetails,
} from '@sitesentinel/shared';

/** Thrown for any non-2xx response; carries the RFC 9457 body when the API sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: ProblemDetails,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

const API_BASE = '/api/v1';

export async function apiGet(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    ...init,
  });
  if (!res.ok && res.headers.get('content-type')?.startsWith(PROBLEM_CONTENT_TYPE)) {
    const parsed = problemDetailsSchema.safeParse(await res.json());
    throw new ApiError(res.status, parsed.success ? parsed.data : undefined);
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
