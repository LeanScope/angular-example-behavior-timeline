// Files imported as text (`import x from './file.vtt' with { loader: 'text' }`), e.g. the demo
// transcripts in the specs.
declare module '*.vtt' {
  const content: string;
  export default content;
}
declare module '*.svg' {
  const content: string;
  export default content;
}
