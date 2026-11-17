import type { Stimulus } from './study.model';

/** Reads a repository file: a URL to show it and its own MIME type (`RepositoryResourcesService.file`). */
export type ReadRepositoryFile = (resourceRef: string, fileRef: string) => Promise<{ url: string; mimeType: string }>;

/**
 * Fetches the stimuli a recording keeps in its repository (`resourceRef` + `fileRef`) and returns
 * the ones that loaded, each with its `url`.
 *
 * The MIME type is the file's own: a stimulus the manifest gave none (the server's export never
 * does) takes it from the fetched file, one that states it keeps its own. A file that occurs
 * several times (a stimulus comes back later, or is compared with another) is fetched once.
 */
export async function loadRepositoryStimuli(files: Stimulus[], read: ReadRepositoryFile): Promise<Stimulus[]> {
  const fetched = new Map<string, ReturnType<ReadRepositoryFile>>();
  const once = (resourceRef: string, fileRef: string) => {
    const id = `${resourceRef}/${fileRef}`.toLowerCase();
    let file = fetched.get(id);
    if (!file) fetched.set(id, (file = read(resourceRef, fileRef)));
    return file;
  };
  const settled = await Promise.allSettled(
    files.map(async (s): Promise<Stimulus> => {
      const file = await once(s.resourceRef!, s.fileRef!);
      return { ...s, url: file.url, mimeType: s.mimeType || file.mimeType };
    }),
  );
  return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
}
