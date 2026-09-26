/** Conflicting local drafts remain available instead of silently choosing one. */
export interface LocalRestoreConflict {
  path: string;
  current: unknown;
  incoming: unknown;
}
export function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
export function restoreVariantId(id: string, value: unknown): string {
  const text = stableJSON(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${id}~restored-${(hash >>> 0).toString(16)}`;
}
export function mergeRestoreItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const result = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = result.get(item.id);
    if (!existing) {
      result.set(item.id, item);
      continue;
    }
    if (stableJSON(existing) === stableJSON(item)) continue;
    let id = restoreVariantId(item.id, item);
    let suffix = 1;
    while (result.has(id) && stableJSON(result.get(id)) !== stableJSON({ ...item, id }))
      id = `${restoreVariantId(item.id, item)}-${suffix++}`;
    result.set(id, { ...item, id });
  }
  return [...result.values()];
}
export function mergeRestoreConflicts(
  ...groups: (LocalRestoreConflict[] | undefined)[]
): LocalRestoreConflict[] {
  return [
    ...new Map(
      groups.flatMap((group) => group || []).map((item) => [stableJSON(item), item]),
    ).values(),
  ];
}
export function mergeRestoreMap<T>(
  current: Record<string, T>,
  incoming: Record<string, T>,
  path: string,
  conflicts: LocalRestoreConflict[],
): Record<string, T> {
  const result = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!Object.hasOwn(current, key)) result[key] = value;
    else if (stableJSON(current[key]) !== stableJSON(value))
      conflicts.push({ path: `${path}.${key}`, current: current[key], incoming: value });
  }
  return result;
}
