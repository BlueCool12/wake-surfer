import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createPrismaUserStore } from "../src/adapters/prisma-user-store";
import type { PrismaService } from "../src/prisma/prisma.service";

type IdentityRow = { userId: string };

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function fakePrisma(options: {
  findUnique?: (args: unknown) => Promise<IdentityRow | null>;
  create?: (args: unknown) => Promise<{ id: string }>;
}) {
  const findUnique = vi.fn(options.findUnique ?? (async () => null));
  const create = vi.fn(options.create ?? (async () => ({ id: "new-user" })));
  return {
    prisma: {
      identity: { findUnique },
      user: { create },
    } as unknown as PrismaService,
    findUnique,
    create,
  };
}

const newAccount = {
  provider: "github",
  providerUserId: "583231",
  email: "octocat@github.com",
  login: "octocat",
};

describe("createPrismaUserStore", () => {
  it("(provider, providerUserId) 복합 키로 조회한다", async () => {
    const { prisma, findUnique } = fakePrisma({});

    await createPrismaUserStore(prisma).findByProvider("github", "583231");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_providerUserId: { provider: "github", providerUserId: "583231" } },
      }),
    );
  });

  it("기존 회원이 있으면 그 회원 id를 돌려준다", async () => {
    const { prisma } = fakePrisma({ findUnique: async () => ({ userId: "existing-user" }) });

    await expect(createPrismaUserStore(prisma).findByProvider("github", "583231")).resolves.toEqual(
      { id: "existing-user" },
    );
  });

  it("없으면 undefined를 돌려준다", async () => {
    const { prisma } = fakePrisma({});

    await expect(
      createPrismaUserStore(prisma).findByProvider("github", "583231"),
    ).resolves.toBeUndefined();
  });

  it("회원과 로그인 수단을 중첩 create로 함께 만든다", async () => {
    const { prisma, create } = fakePrisma({});

    await createPrismaUserStore(prisma).create(newAccount);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: "octocat@github.com",
          login: "octocat",
          identities: { create: { provider: "github", providerUserId: "583231" } },
        },
      }),
    );
  });

  it("동시 요청으로 유니크 충돌이 나면 기존 회원을 재조회해 돌려준다", async () => {
    let found: IdentityRow | null = null;
    const { prisma, create } = fakePrisma({
      // 첫 조회는 없음 → create 시도 → 그 사이 다른 요청이 만들어 충돌 → 재조회는 있음
      findUnique: async () => found,
      create: async () => {
        found = { userId: "winner-user" };
        throw uniqueViolation();
      },
    });

    await expect(createPrismaUserStore(prisma).create(newAccount)).resolves.toEqual({
      id: "winner-user",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("유니크 충돌인데 재조회도 비면 예외를 그대로 올린다", async () => {
    const { prisma } = fakePrisma({
      create: async () => {
        throw uniqueViolation();
      },
    });

    await expect(createPrismaUserStore(prisma).create(newAccount)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("유니크 충돌이 아닌 오류는 삼키지 않는다", async () => {
    const { prisma } = fakePrisma({
      create: async () => {
        throw new Error("connection refused");
      },
    });

    await expect(createPrismaUserStore(prisma).create(newAccount)).rejects.toThrow(
      "connection refused",
    );
  });
});
