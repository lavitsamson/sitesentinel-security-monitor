import { ApiError } from './client';

/** A sentence that is safe and useful to show the user for any thrown value. */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) return 'Something went wrong on our side. Please try again.';
    return err.problem?.detail ?? err.message;
  }
  if (err instanceof TypeError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return 'Something went wrong. Please try again.';
}
