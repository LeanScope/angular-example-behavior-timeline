/**
 * The browser's own file dialog with a memory per place: `showOpenFilePicker` remembers the last
 * folder for each `id`, so every drop zone opens where its last document was picked. The page never
 * learns that folder (no path reaches it), the browser keeps it.
 *
 * A place that has no folder of its own yet opens where the last document (for any place) was
 * picked, instead of the browser's default folder.
 *
 * Only Chromium browsers have this API (and not in a cross-origin iframe). Elsewhere `pickFiles`
 * returns `'unsupported'` and the zone falls back to its `<input type="file">`, whose folder the
 * browser shares between all zones.
 */

interface PickerType {
  description?: string;
  accept: Record<string, string[]>;
}
interface FileHandle {
  getFile(): Promise<File>;
}
type ShowOpenFilePicker = (options: {
  id?: string;
  startIn?: FileHandle;
  multiple?: boolean;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
}) => Promise<FileHandle[]>;

/** The ids whose folder the browser remembers (it doesn't tell): kept per browser, like its memory. */
const USED_KEY = 'file-picker.used-ids';
/** The last file picked in this page, at any place: where a new place starts. */
let lastPicked: FileHandle | undefined;

function usedIds(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(USED_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function markUsed(id: string): void {
  try {
    const ids = usedIds();
    if (!ids.includes(id)) localStorage.setItem(USED_KEY, JSON.stringify([...ids, id]));
  } catch {
    // No storage: the place then starts at the last folder again next time, which is harmless.
  }
}

/** File endings for the MIME types an `accept` names without them (the dialog wants both). */
const KNOWN_ENDINGS: Record<string, string[]> = {
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'],
  'application/pdf': ['.pdf'],
  'text/markdown': ['.md', '.markdown'],
  'text/vtt': ['.vtt'],
};

/** An `<input accept>` list as the picker's `types`; endings of their own go together. */
export function pickerTypes(accept: string | null): PickerType[] {
  if (!accept) return [];
  const entries: Record<string, string[]> = {};
  const add = (mime: string, endings: string[]) => {
    const list = (entries[mime] ??= []);
    for (const e of endings) if (!list.includes(e)) list.push(e);
  };
  for (const token of accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    if (token.startsWith('.')) add('application/octet-stream', [token]);
    else add(token, KNOWN_ENDINGS[token] ?? []);
  }
  const accepted = Object.fromEntries(Object.entries(entries).filter(([, endings]) => endings.length));
  return Object.keys(accepted).length ? [{ accept: accepted }] : [];
}

/** A picker id the browser accepts: at most 32 letters, digits, `-` and `_`. */
export function pickerId(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
}

/**
 * Opens the dialog for the place `id`. Resolves to the files picked, `[]` when the user cancels,
 * or `'unsupported'` when the browser can't do it here (then the caller uses its file input).
 */
export async function pickFiles(
  id: string,
  options: { accept: string | null; multiple: boolean },
): Promise<File[] | 'unsupported'> {
  const show = (globalThis as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
  if (typeof show !== 'function') return 'unsupported';
  const key = pickerId(id);
  // A start folder beats the one the browser remembers for the id: only for a place without one.
  const startIn = usedIds().includes(key) ? undefined : lastPicked;
  try {
    const handles = await show({
      id: key,
      multiple: options.multiple,
      types: pickerTypes(options.accept),
      ...(startIn ? { startIn } : {}),
    });
    if (handles.length) {
      lastPicked = handles[0];
      markUsed(key);
    }
    return await Promise.all(handles.map((h) => h.getFile()));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    // E.g. a SecurityError in a cross-origin iframe: the file input still works there.
    return 'unsupported';
  }
}

/** Whether the dialog with a memory per place is there to use. */
export function canPickPerPlace(): boolean {
  return typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}
