/**
 * The facet (input slot) a step asks for, read from the step's `questions` envelope.
 *
 * When a choreo asks for one of its inputs, the agent server records the step with
 * `questions = {"type":"tool_input_schema","toolName":"__facet_<facetGuid>__",…}`. The facet guid
 * names the slot independently of its field keys, so an app can recognise a slot it has a place
 * for. Prompts that are not facet asks (a tool's own form, plain text) carry no facet guid.
 */
export function facetGuidOf(questions: string | null | undefined): string | null {
  if (!questions || !questions.includes('__facet_')) return null;
  try {
    const envelope = JSON.parse(questions) as { toolName?: unknown };
    if (typeof envelope.toolName !== 'string') return null;
    return /^__facet_(.+)__$/.exec(envelope.toolName)?.[1] ?? null;
  } catch {
    return null;
  }
}
