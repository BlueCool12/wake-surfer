import type { AuthSession, AuthSessionStorePort } from "../src/runtime-deps";
export function memorySessions(): AuthSessionStorePort {
  const rows = new Map<string, AuthSession>();
  return {
    async create(s) {
      rows.set(s.id, { ...s });
    },
    async find(id) {
      const s = rows.get(id);
      return s ? { ...s } : undefined;
    },
    async rotate(i) {
      const s = rows.get(i.id);
      if (
        !s ||
        s.userId !== i.userId ||
        s.currentRefreshJti !== i.previousJti ||
        s.revokedAt !== null ||
        s.expiresAt <= i.now
      )
        return false;
      rows.set(s.id, { ...s, currentRefreshJti: i.nextJti });
      return true;
    },
    async revoke(id, userId, now) {
      const s = rows.get(id);
      if (s && s.userId === userId && s.revokedAt === null) rows.set(id, { ...s, revokedAt: now });
    },
  };
}
