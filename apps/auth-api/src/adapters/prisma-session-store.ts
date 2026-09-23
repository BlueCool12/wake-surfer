import type { PrismaClient } from "@prisma/client";
import type { AuthSessionStorePort } from "@wake-surfer/oauth";

export function createPrismaSessionStore(prisma: PrismaClient): AuthSessionStorePort {
  return {
    async create(session) {
      await prisma.authSession.create({
        data: {
          id: session.id,
          userId: session.userId,
          currentRefreshJti: session.currentRefreshJti,
          expiresAt: new Date(session.expiresAt * 1000),
          revokedAt: null,
        },
      });
    },
    async find(id) {
      const row = await prisma.authSession.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            userId: row.userId,
            currentRefreshJti: row.currentRefreshJti,
            expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
            revokedAt: row.revokedAt === null ? null : Math.floor(row.revokedAt.getTime() / 1000),
          }
        : undefined;
    },
    async rotate(input) {
      const result = await prisma.authSession.updateMany({
        where: {
          id: input.id,
          userId: input.userId,
          currentRefreshJti: input.previousJti,
          revokedAt: null,
          expiresAt: { gt: new Date(input.now * 1000) },
        },
        data: { currentRefreshJti: input.nextJti },
      });
      return result.count === 1;
    },
    async revoke(id, userId, now) {
      await prisma.authSession.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date(now * 1000) },
      });
    },
  };
}
