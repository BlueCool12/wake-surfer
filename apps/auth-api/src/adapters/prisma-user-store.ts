import type { AuthenticatedUser, UserStorePort } from "@wake-surfer/oauth";
import { Prisma } from "@prisma/client";

import type { PrismaService } from "../prisma/prisma.service";

/** Prisma가 유니크 제약 위반에 쓰는 코드. */
const UNIQUE_VIOLATION = "P2002";

/**
 * `(provider, providerUserId)`로 회원을 조회하거나 생성하는 UserStorePort 구현.
 *
 * 동시 요청(로그인 버튼 연타 등)이 둘 다 "없음"으로 판정해 각각 생성을 시도할 수 있다.
 * 유니크 제약이 두 번째를 막으므로, 그 예외를 잡아 재조회해 기존 회원을 돌려준다.
 */
export function createPrismaUserStore(prisma: PrismaService): UserStorePort {
  async function findByProvider(
    provider: string,
    providerUserId: string,
  ): Promise<AuthenticatedUser | undefined> {
    const identity = await prisma.identity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      select: { userId: true },
    });
    return identity ? { id: identity.userId } : undefined;
  }

  return {
    findByProvider,

    create: async ({ provider, providerUserId, email, login }) => {
      try {
        const user = await prisma.user.create({
          data: {
            email,
            login,
            identities: { create: { provider, providerUserId } },
          },
          select: { id: true },
        });
        return { id: user.id };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION
        ) {
          const existing = await findByProvider(provider, providerUserId);
          if (existing) {
            return existing;
          }
        }
        throw error;
      }
    },
  };
}
