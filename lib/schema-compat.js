// DSH 0.2.1 requires object schemas to state their extra-property policy.
export function explicitObjectSchemas(value) {
  if (Array.isArray(value)) return value.map(explicitObjectSchemas);
  if (!value || typeof value !== 'object') return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, explicitObjectSchemas(child)]));
  if (next.type === 'object' && next.additionalProperties === undefined) {
    next.additionalProperties = next.properties ? false : true;
  }
  return next;
}
