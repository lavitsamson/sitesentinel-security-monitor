import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type ResponseConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PROBLEM_CONTENT_TYPE,
  alertChannelSchema,
  bulkSitesResultSchema,
  bulkSitesSchema,
  changePasswordSchema,
  checkNowResultSchema,
  checkRunSchema,
  createAlertChannelSchema,
  createSiteSchema,
  createdAlertChannelSchema,
  forgotPasswordSchema,
  healthLiveSchema,
  healthReadySchema,
  incidentSchema,
  latestRunsSchema,
  listAlertChannelsQuerySchema,
  listIncidentsQuerySchema,
  listRunsQuerySchema,
  listSitesQuerySchema,
  loginSchema,
  paginatedSchema,
  problemDetailsSchema,
  publicUserSchema,
  registerSchema,
  resetPasswordSchema,
  scoreHistoryQuerySchema,
  scoreHistorySchema,
  siteSchema,
  siteSummarySchema,
  testAlertResultSchema,
  updateAlertChannelSchema,
  updateProfileSchema,
  updateSiteSchema,
  verificationAttemptSchema,
  verifySiteSchema,
} from '@sitesentinel/shared';
import { ACCESS_COOKIE } from '../auth/cookies.js';

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
  const User = register('User', publicUserSchema);
  const Site = register('Site', siteSchema);
  const SitePage = register('SitePage', paginatedSchema(siteSchema));
  const SiteSummary = register('SiteSummary', siteSummarySchema);
  register('CheckRun', checkRunSchema);
  const CheckRunPage = register('CheckRunPage', paginatedSchema(checkRunSchema));
  const LatestRuns = register('LatestRuns', latestRunsSchema);
  const ScoreHistory = register('ScoreHistory', scoreHistorySchema);
  const Incident = register('Incident', incidentSchema);
  const IncidentPage = register('IncidentPage', paginatedSchema(incidentSchema));
  const BulkSitesResult = register('BulkSitesResult', bulkSitesResultSchema);
  const CheckNowResult = register('CheckNowResult', checkNowResultSchema);
  const AlertChannel = register('AlertChannel', alertChannelSchema);
  const AlertChannelPage = register('AlertChannelPage', paginatedSchema(alertChannelSchema));
  const CreatedAlertChannel = register('CreatedAlertChannel', createdAlertChannelSchema);
  const TestAlertResult = register('TestAlertResult', testAlertResultSchema);
  const VerificationFailure = register(
    'VerificationFailure',
    problemDetailsSchema.extend({ attempts: z.array(verificationAttemptSchema) }),
  );

  const cookieAuth = registry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: ACCESS_COOKIE,
    description: 'Short-lived access token, set by login/register/refresh as an httpOnly cookie.',
  });
  const secured = [{ [cookieAuth.name]: [] }];
  const csrfHeader = z.string().openapi({
    description:
      'Required on every mutating request (CSRF protection). Any value, e.g. XMLHttpRequest.',
    example: 'XMLHttpRequest',
  });
  const siteIdParams = z.object({
    id: z.string().openapi({ example: '6712f0c2a1b2c3d4e5f60718' }),
  });

  const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
  const problem = (description: string): ResponseConfig => ({
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
  });
  const ok = (description: string, schema?: z.ZodType): ResponseConfig =>
    schema ? { description, ...json(schema) } : { description };
  const errors = {
    400: problem('Validation failed'),
    401: problem('Not signed in'),
    403: problem('Missing X-Requested-With header'),
    404: problem("Not found (also returned for other users' resources)"),
    409: problem('Conflict'),
    429: problem('Rate limited'),
  };
  const pick = <K extends keyof typeof errors>(...codes: K[]) =>
    Object.fromEntries(codes.map((c) => [c, errors[c]])) as Pick<typeof errors, K>;

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

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/metrics`,
    tags: ['Ops'],
    summary: 'Prometheus metrics: HTTP traffic and queue depth',
    description:
      'Prometheus text format. Requires `Authorization: Bearer <METRICS_TOKEN>` when the API is configured with a token. Job metrics (processed, duration, failures) are served by the worker on its own metrics port.',
    responses: {
      200: {
        description: 'Current metrics',
        content: { 'text/plain': { schema: z.string() } },
      },
      401: problem('Missing or wrong metrics token'),
    },
  });

  // --- Auth -----------------------------------------------------------------
  const csrf = { headers: z.object({ 'x-requested-with': csrfHeader }) };

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/register`,
    tags: ['Auth'],
    summary: 'Create an account and sign in',
    request: { ...csrf, body: json(registerSchema.clone()) },
    responses: {
      201: ok('Signed in; session cookies set', User),
      ...pick(400, 403, 409, 429),
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/login`,
    tags: ['Auth'],
    summary: 'Sign in (rate-limited to 5/min per IP and email)',
    request: { ...csrf, body: json(loginSchema.clone()) },
    responses: { 200: ok('Signed in; session cookies set', User), ...pick(400, 401, 403, 429) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/refresh`,
    tags: ['Auth'],
    summary: 'Rotate the refresh token; reuse of an old token revokes the session family',
    request: csrf,
    responses: { 204: ok('New session cookies set'), ...pick(401, 403) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/logout`,
    tags: ['Auth'],
    summary: 'End the current session',
    request: csrf,
    responses: { 204: ok('Signed out; cookies cleared'), ...pick(403) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/auth/me`,
    tags: ['Auth'],
    summary: 'The signed-in user',
    security: secured,
    responses: { 200: ok('Current user', User), ...pick(401) },
  });

  registry.registerPath({
    method: 'patch',
    path: `${API_PREFIX}/auth/me`,
    tags: ['Auth'],
    summary: 'Update your name or email alert preference',
    security: secured,
    request: { ...csrf, body: json(updateProfileSchema.clone()) },
    responses: { 200: ok('Updated user', User), ...pick(400, 401, 403) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/change-password`,
    tags: ['Auth'],
    summary: 'Change your password; ends every other session (5/min per user)',
    description:
      'A wrong current password is a 400 with an error on `currentPassword`. New session cookies are set for the caller.',
    security: secured,
    request: { ...csrf, body: json(changePasswordSchema.clone()) },
    responses: { 204: ok('Password changed'), ...pick(400, 401, 403, 429) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/forgot-password`,
    tags: ['Auth'],
    summary: 'Email a password-reset link (always 202, whether or not the account exists)',
    request: { ...csrf, body: json(forgotPasswordSchema.clone()) },
    responses: { 202: ok('Accepted'), ...pick(400, 403, 429) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/auth/reset-password`,
    tags: ['Auth'],
    summary: 'Set a new password with a single-use token; ends every session',
    request: { ...csrf, body: json(resetPasswordSchema.clone()) },
    responses: { 204: ok('Password changed'), ...pick(400, 403) },
  });

  // --- Sites ----------------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites`,
    tags: ['Sites'],
    summary: 'List your sites (cursor pagination, filters, sorting)',
    security: secured,
    request: { query: listSitesQuerySchema.clone() },
    responses: { 200: ok('A page of sites', SitePage), ...pick(400, 401) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/sites`,
    tags: ['Sites'],
    summary: 'Add a site; returns the token used to verify ownership',
    security: secured,
    request: { ...csrf, body: json(createSiteSchema.clone()) },
    responses: { 201: ok('Created', Site), ...pick(400, 401, 403, 409) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/{id}`,
    tags: ['Sites'],
    summary: 'Get one of your sites',
    security: secured,
    request: { params: siteIdParams },
    responses: { 200: ok('The site', Site), ...pick(401, 404) },
  });

  registry.registerPath({
    method: 'patch',
    path: `${API_PREFIX}/sites/{id}`,
    tags: ['Sites'],
    summary: 'Update display name, interval, paused or tags (the domain is immutable)',
    security: secured,
    request: { ...csrf, params: siteIdParams, body: json(updateSiteSchema.clone()) },
    responses: { 200: ok('Updated', Site), ...pick(400, 401, 403, 404) },
  });

  registry.registerPath({
    method: 'delete',
    path: `${API_PREFIX}/sites/{id}`,
    tags: ['Sites'],
    summary: 'Delete a site',
    security: secured,
    request: { ...csrf, params: siteIdParams },
    responses: { 204: ok('Deleted'), ...pick(401, 403, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/sites/{id}/verify`,
    tags: ['Sites'],
    summary: 'Prove ownership via DNS TXT `sitesentinel-verify=<token>` or the well-known file',
    description:
      'Without a method, DNS TXT is tried first, then https://<domain>/.well-known/sitesentinel-verify.txt (no redirects followed). Rate-limited to 10 per 10 minutes per user.',
    security: secured,
    request: { ...csrf, params: siteIdParams, body: json(verifySiteSchema.clone()) },
    responses: {
      200: ok('Verified', Site),
      422: {
        description: 'Ownership could not be proven; each attempt is explained',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: VerificationFailure } },
      },
      ...pick(400, 401, 403, 404, 429),
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/sites/{id}/check-now`,
    tags: ['Sites'],
    summary: 'Queue every check for a site now (1 per site per 5 minutes)',
    description:
      'The checks run in the background; poll /runs/latest for results. Unverified, paused and demo sites are refused with 409.',
    security: secured,
    request: { ...csrf, params: siteIdParams },
    responses: { 202: ok('Queued', CheckNowResult), ...pick(401, 403, 404, 409, 429) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/sites/bulk`,
    tags: ['Sites'],
    summary: 'Check now, pause, resume, delete or tag up to 100 sites',
    description:
      'Each id is either in `succeeded` or in `skipped` with a reason. Ids of sites you do not own are skipped as NOT_FOUND.',
    security: secured,
    request: { ...csrf, body: json(bulkSitesSchema.clone()) },
    responses: { 200: ok('Applied', BulkSitesResult), ...pick(400, 401, 403, 429) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/summary`,
    tags: ['Sites'],
    summary: 'Dashboard summary: counts by grade and status, and sites needing attention',
    security: secured,
    responses: { 200: ok('Summary of your sites', SiteSummary), ...pick(401) },
  });

  // --- Results --------------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/{id}/runs`,
    tags: ['Results'],
    summary: 'Check run history, newest first (kept for 90 days)',
    security: secured,
    request: { params: siteIdParams, query: listRunsQuerySchema.clone() },
    responses: { 200: ok('A page of runs', CheckRunPage), ...pick(400, 401, 404) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/{id}/runs/latest`,
    tags: ['Results'],
    summary: 'The newest run of each check type',
    security: secured,
    request: { params: siteIdParams },
    responses: { 200: ok('Latest runs', LatestRuns), ...pick(401, 404) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/{id}/score-history`,
    tags: ['Results'],
    summary: 'Overall score per UTC day',
    security: secured,
    request: { params: siteIdParams, query: scoreHistoryQuerySchema.clone() },
    responses: { 200: ok('One point per day', ScoreHistory), ...pick(400, 401, 404) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/sites/{id}/report.pdf`,
    tags: ['Results'],
    summary: 'One-page PDF summary of a site (10 per minute)',
    description:
      'Generated on demand from the latest results: grade, per-check results, 30-day score trend, open incidents, and findings with recommendations. Sent as an attachment and never cached.',
    security: secured,
    request: { params: siteIdParams },
    responses: {
      200: {
        description: 'The report',
        content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      ...pick(401, 404, 429),
    },
  });

  // --- Incidents ------------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/incidents`,
    tags: ['Incidents'],
    summary: 'Your incidents, newest first',
    security: secured,
    request: { query: listIncidentsQuerySchema.clone() },
    responses: { 200: ok('A page of incidents', IncidentPage), ...pick(400, 401) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/incidents/{id}`,
    tags: ['Incidents'],
    summary: 'Get one of your incidents',
    security: secured,
    request: { params: siteIdParams },
    responses: { 200: ok('The incident', Incident), ...pick(401, 404) },
  });

  // --- Alert channels -------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/alert-channels`,
    tags: ['Alerts'],
    summary: 'Your alert channels, oldest first',
    security: secured,
    request: { query: listAlertChannelsQuerySchema.clone() },
    responses: { 200: ok('A page of channels', AlertChannelPage), ...pick(400, 401) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/alert-channels`,
    tags: ['Alerts'],
    summary: 'Add an email or webhook channel (at most 10)',
    description:
      'A webhook gets an HMAC-SHA256 signing secret, returned in this response only and stored encrypted. Webhook URLs must be https on the default port and point to a public host; every delivery also goes through the SSRF guard.',
    security: secured,
    request: { ...csrf, body: json(createAlertChannelSchema.clone()) },
    responses: { 201: ok('Created', CreatedAlertChannel), ...pick(400, 401, 403, 409) },
  });

  registry.registerPath({
    method: 'get',
    path: `${API_PREFIX}/alert-channels/{id}`,
    tags: ['Alerts'],
    summary: 'Get one of your alert channels',
    security: secured,
    request: { params: siteIdParams },
    responses: { 200: ok('The channel', AlertChannel), ...pick(401, 404) },
  });

  registry.registerPath({
    method: 'patch',
    path: `${API_PREFIX}/alert-channels/{id}`,
    tags: ['Alerts'],
    summary: 'Rename, retarget, pause or resume a channel (the type is fixed)',
    security: secured,
    request: { ...csrf, params: siteIdParams, body: json(updateAlertChannelSchema.clone()) },
    responses: { 200: ok('Updated', AlertChannel), ...pick(400, 401, 403, 404) },
  });

  registry.registerPath({
    method: 'delete',
    path: `${API_PREFIX}/alert-channels/{id}`,
    tags: ['Alerts'],
    summary: 'Delete a channel and its delivery history',
    security: secured,
    request: { ...csrf, params: siteIdParams },
    responses: { 204: ok('Deleted'), ...pick(401, 403, 404) },
  });

  registry.registerPath({
    method: 'post',
    path: `${API_PREFIX}/alert-channels/{id}/test`,
    tags: ['Alerts'],
    summary: 'Send a sample alert (3 per channel per 5 minutes)',
    description:
      "Delivered by the worker in the background, even to an inactive channel; poll the channel's `lastDelivery` for the outcome.",
    security: secured,
    request: { ...csrf, params: siteIdParams },
    responses: { 202: ok('Queued', TestAlertResult), ...pick(401, 403, 404, 429) },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'SiteSentinel API',
      version,
      description:
        'Passive security & health monitoring for websites you own. Errors use RFC 9457 Problem Details. Auth uses httpOnly cookies; mutating requests need an X-Requested-With header.',
    },
  });
}
