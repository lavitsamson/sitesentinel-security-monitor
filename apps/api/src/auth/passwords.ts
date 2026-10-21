import argon2 from 'argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * Pass `null` when the account doesn't exist: a dummy hash is still verified,
   * so response time doesn't reveal which emails are registered.
   */
  verify(hash: string | null, password: string): Promise<boolean>;
}

export interface Argon2Cost {
  /** KiB. */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** OWASP Password Storage Cheat Sheet baseline for argon2id. */
export const OWASP_ARGON2_COST: Argon2Cost = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function createPasswordHasher(cost: Argon2Cost = OWASP_ARGON2_COST): PasswordHasher {
  const options: argon2.HashOptions = { type: argon2.argon2id, ...cost };
  let dummyHash: Promise<string> | undefined;

  return {
    hash: (password) => argon2.hash(password, options),
    async verify(hash, password) {
      dummyHash ??= argon2.hash('dummy password for timing', options);
      try {
        const ok = await argon2.verify(hash ?? (await dummyHash), password);
        return hash !== null && ok;
      } catch {
        return false; // malformed hash
      }
    },
  };
}
