import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PROBLEM_CONTENT_TYPE,
  healthLiveSchema,
  healthReadySchema,
  problemDetailsSchema,
} from '@sitesentinel/shared';

// Adds `.openapi()` to zod schemas. zod v4 attaches methods when a schema is
// constructed, so schemas created earlier (in @sitesentinel/shared) only gain it
// once cloned; that keeps zod-to-openapi out of the shared package and web bundle.
extendZodWithOpenApi(z);

export const API_PREFIX = '/api/v1';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

/** Builds the OpenAPI 3.1 document from the same zod schemas the API validates with. */
export function buildOpenApiDocument(version: string): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  const register = <T extends z.ZodType>(refId: string, schema: T): T =>
    registry.register(refId, schema.clone());

  const Problem = register('ProblemDetails', problemDetailsSchema);
  const HealthLive = register('HealthLive', healthLiveSchema);
  const HealthReady = register('HealthReady', healthReadySchema);

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/health/live`,
    tags: ['Ops'],
    summary: 'Liveness probe',
    responses: {
      200: {
        description: 'Process is alive',
        content: { 'application/json': { schema: HealthLive } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/health/ready`,
    tags: ['Ops'],
    summary: 'Readiness probe (MongoDB + Redis)',
    responses: {
      200: {
        description: 'All dependencies are up',
        content: { 'application/json': { schema: HealthReady } },
      },
      503: {
        description: 'At least one dependency is down',
        content: { 'application/json': { schema: HealthReady } },
      },
      default: {
        description: 'Error',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
      },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'SiteSentinel API',
      version,
      description:
        'Passive security & health monitoring for websites you own. Errors use RFC 9457 Problem Details.',
    },
  });
}
