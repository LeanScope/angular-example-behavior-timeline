import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickFiles, pickerId, pickerTypes } from './file-picker';

describe('file picker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('turns an accept list into picker types, endings of their own together', () => {
    expect(pickerTypes('.md,.docx,text/markdown,image/*,application/x-unknown')).toEqual([
      {
        accept: {
          'application/octet-stream': ['.md', '.docx'],
          'text/markdown': ['.md', '.markdown'],
          'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'],
        },
      },
    ]);
    expect(pickerTypes(null)).toEqual([]);
  });

  it('keeps ids within what the browser accepts', () => {
    expect(pickerId('interview guide/1')).toBe('interview-guide-1');
    expect(pickerId('x'.repeat(40))).toHaveLength(32);
  });

  it('opens the dialog for the place and reads the picked files', async () => {
    const file = new File(['a'], 'a.md');
    const show = vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]);
    vi.stubGlobal('showOpenFilePicker', show);
    expect(await pickFiles('screener', { accept: '.md', multiple: false })).toEqual([file]);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ id: 'screener', multiple: false }));
  });

  it('gives nothing on cancel, and falls back where the dialog is missing or refused', async () => {
    expect(await pickFiles('screener', { accept: null, multiple: false })).toBe('unsupported');
    vi.stubGlobal('showOpenFilePicker', () => Promise.reject(new DOMException('', 'AbortError')));
    expect(await pickFiles('screener', { accept: null, multiple: false })).toEqual([]);
    vi.stubGlobal('showOpenFilePicker', () => Promise.reject(new DOMException('', 'SecurityError')));
    expect(await pickFiles('screener', { accept: null, multiple: false })).toBe('unsupported');
  });

  it('starts a new place in the last folder picked, a used place in its own', async () => {
    const guide = { getFile: () => Promise.resolve(new File(['g'], 'guide.docx')) };
    const show = vi.fn().mockResolvedValue([guide]);
    vi.stubGlobal('showOpenFilePicker', show);
    await pickFiles('interview-guide', { accept: null, multiple: false });
    await pickFiles('screener', { accept: null, multiple: false });
    expect(show.mock.calls[1][0]).toEqual(expect.objectContaining({ id: 'screener', startIn: guide }));
    await pickFiles('screener', { accept: null, multiple: false });
    expect(show.mock.calls[2][0].startIn).toBeUndefined();
  });
});
