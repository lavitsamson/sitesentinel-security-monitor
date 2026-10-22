import {
  MAX_ALERT_CHANNELS,
  alertChannelSchema,
  createdAlertChannelSchema,
  paginatedSchema,
  testAlertResultSchema,
  type AlertChannel,
  type CreateAlertChannelInput,
  type CreatedAlertChannel,
  type Paginated,
  type TestAlertResult,
  type UpdateAlertChannelInput,
} from '@sitesentinel/shared';
import { apiRequest } from './client';

const channelPageSchema = paginatedSchema(alertChannelSchema);

export const alertChannelsApi = {
  /** An account has at most MAX_ALERT_CHANNELS channels, so one page holds them all. */
  list: (signal?: AbortSignal): Promise<Paginated<AlertChannel>> =>
    apiRequest('GET', `/alert-channels?limit=${MAX_ALERT_CHANNELS}`, {
      schema: channelPageSchema,
      signal,
    }),

  get: (id: string): Promise<AlertChannel> =>
    apiRequest('GET', `/alert-channels/${id}`, { schema: alertChannelSchema }),

  create: (input: CreateAlertChannelInput): Promise<CreatedAlertChannel> =>
    apiRequest('POST', '/alert-channels', { body: input, schema: createdAlertChannelSchema }),

  update: (id: string, patch: UpdateAlertChannelInput): Promise<AlertChannel> =>
    apiRequest('PATCH', `/alert-channels/${id}`, { body: patch, schema: alertChannelSchema }),

  remove: (id: string): Promise<void> => apiRequest('DELETE', `/alert-channels/${id}`),

  test: (id: string): Promise<TestAlertResult> =>
    apiRequest('POST', `/alert-channels/${id}/test`, { schema: testAlertResultSchema }),
};
