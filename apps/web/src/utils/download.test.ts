import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from './download';

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clicks a temporary download link, then releases the blob', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    saveBlob(new Blob(['%PDF']), 'report.pdf');

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('report.pdf');
    expect(clicked[0]?.href).toBe('blob:report');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    vi.unstubAllGlobals();
  });
});
