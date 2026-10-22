import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Scans the current page for WCAG 2.2 AA problems and fails on serious or
 * critical ones, listing each rule with the offending selectors. A soft
 * assertion, so one run reports every page with problems, not just the first.
 */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  // Mid-transition (a menu fading in) text is translucent and fails contrast
  // checks it would pass at rest, so let running animations finish first
  // (skipping infinite ones such as spinners, which never do).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => null)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  expect.soft(blocking, `${label}: accessibility violations`).toEqual([]);
}
