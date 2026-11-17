import { facetGuidOf } from './facet-guid';

describe('facetGuidOf', () => {
  it('reads the facet guid from a facet ask', () => {
    const questions = JSON.stringify({
      type: 'tool_input_schema',
      toolName: '__facet_f9c9d201-8669-46ce-9fb4-bcbdcbbdeb14__',
      schema: {},
    });
    expect(facetGuidOf(questions)).toBe('f9c9d201-8669-46ce-9fb4-bcbdcbbdeb14');
  });

  it('is null for other prompts, empty values and broken JSON', () => {
    expect(facetGuidOf(JSON.stringify({ type: 'tool_input_schema', toolName: 'upload_files' }))).toBeNull();
    expect(facetGuidOf(null)).toBeNull();
    expect(facetGuidOf('')).toBeNull();
    expect(facetGuidOf('{"toolName":"__facet_x__"')).toBeNull();
  });
});
