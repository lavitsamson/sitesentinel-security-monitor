import { expect } from '@playwright/test';
import { E2E } from './env.js';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function messagesTo(address: string): Promise<MailpitMessage[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const res = await fetch(`${E2E.mailpitUrl}/api/v1/search?query=${query}`);
  if (!res.ok) throw new Error(`Mailpit search failed: HTTP ${res.status}`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

/** Waits until Mailpit has caught an email to `address` whose subject matches. */
export async function expectEmail(address: string, subject: RegExp): Promise<MailpitMessage> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        found = (await messagesTo(address)).find((m) => subject.test(m.Subject));
        return found?.Subject;
      },
      { timeout: 30_000, message: `email to ${address} matching ${subject}` },
    )
    .toMatch(subject);
  return found as MailpitMessage;
}
