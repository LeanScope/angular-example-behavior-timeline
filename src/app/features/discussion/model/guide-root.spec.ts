import { guideRootGuid, stableGuid } from './guide-root';

describe('guideRootGuid', () => {
  it('matches the guid the agent server derives for an Inventory and the document slot', async () => {
    // Computed with the agent server's own `stableGuid` (Node crypto, SHA-1).
    expect(await guideRootGuid('7cacbf99-93a2-4572-9f72-5c55c8091b64')).toBe(
      '37113b41-d3c8-52f9-8e9c-766463c612fa',
    );
  });

  it('is a version 5 guid with the RFC 4122 variant', async () => {
    const guid = await stableGuid('guide-root', 'x:document');
    expect(guid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
