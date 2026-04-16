/** Normalize phone-like identifiers for stable keys (trim, strip inner spaces). */
export function normalizeAddress(addr: string): string {
  return addr.trim().replace(/\s+/g, '');
}

/** Conversation key for two endpoints (order-independent). */
export function computeThreadId(a: string, b: string): string {
  const x = normalizeAddress(a);
  const y = normalizeAddress(b);
  return [x, y].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)).join('|');
}
