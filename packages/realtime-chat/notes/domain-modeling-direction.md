# realtime-chat 도메인 모델링 방향 메모

## 상태

논의 메모입니다. 현재 구현 계약이 아니며, coding task에서 의존하려면 `owner-docs/` 또는 `public-docs/`로 승격해야 합니다.

## 배경

`packages/realtime-chat`는 app adapter가 아니라 실질적인 realtime chat business logic을 소유하는 feature package입니다. 따라서 `src/api/usecases/*`의 usecase는 HTTP 요청 처리 절차를 길게 펼치는 곳이 아니라, business flow를 조율하고 도메인 규칙은 domain layer에 위임하는 곳이어야 합니다.

현재 `issue-gateway-ticket.usecase.ts`에서 보이는 가장 큰 가독성 문제는 usecase가 도메인 모델에 위임하지 않고 직접 처리한다는 점입니다.

- permission port 호출
- TTL 계산
- 발급/만료 시각 계산
- ticket 문자열 생성
- ticket hash 계산
- 저장 record 조립
- 응답 DTO 조립

이 절차가 한 함수에 펼쳐지면 구현은 짧아 보여도 도메인 문장이 드러나지 않습니다. 이후 gateway 배정, ticket 재발급 제한, ticket secret 회전, 만료 정책 검증, 저장 record 변경 같은 규칙이 추가될 때 usecase가 계속 비대해질 가능성이 큽니다.

## 선택지

### 데이터와 행동을 묶는 rich domain model

Java식 entity/value object에 행동을 넣는 방식입니다.

장점:

- 캡슐화가 명확합니다.
- `ticket.toStoredRecord()`, `ticket.toResponse()`처럼 읽히는 코드를 만들기 쉽습니다.
- 상태 전이와 불변조건을 객체 내부에 숨기기 좋습니다.

주의점:

- TypeScript에서 port 의존성이 필요한 행동까지 객체에 넣으면 domain object가 `clock`, `idGenerator`, `hasher`, mount option 같은 외부 의존성을 빨아들이기 쉽습니다.
- DTO 변환, hashing, persistence record 생성이 모두 method가 되면 객체가 경계 지식을 너무 많이 알 수 있습니다.

### 데이터와 행동을 분리하는 domain function/service

도메인 데이터는 불변 값으로 두고, 규칙은 이름 있는 함수 또는 domain service에 둡니다.

장점:

- port 의존성을 함수/service 입력으로 명확히 드러낼 수 있습니다.
- 계산 규칙을 pure function에 가깝게 테스트하기 쉽습니다.
- public DTO, persistence port, mount option 같은 경계를 분리하기 쉽습니다.
- TypeScript의 type alias, union, plain object와 잘 맞습니다.

주의점:

- 함수를 잘게만 쪼개면 절차형 코드를 파일 여러 개로 흩뜨리는 결과가 될 수 있습니다.
- domain function 이름이 도메인 언어를 담지 못하면 현재 문제를 해결하지 못합니다.

## 현재 선호 방향

`realtime-chat`에서는 전면적인 rich domain model보다 **불변 도메인 데이터 + 이름 있는 domain function/service** 방향이 더 적합해 보입니다.

기준은 다음과 같습니다.

- 긴 생명주기, 상태 전이, 계속 유지해야 하는 불변조건이 있으면 class/entity를 고려합니다.
- 한 번 계산해서 결과를 만드는 규칙, 포트와 직렬화 경계가 많은 규칙은 plain data와 domain function/service로 둡니다.
- usecase는 business flow 조율만 담당하고, 도메인 정책과 도메인 값 생성은 domain layer에 위임합니다.

`issueGatewayTicket`은 현재 기준으로는 entity보다 domain service에 가깝습니다. ticket은 긴 생명주기를 가진 객체라기보다 발급 시점에 만들어지는 짧은 수명의 접속권 값입니다.

따라서 방향은 다음과 같습니다.

```txt
usecase
  - 필요한 dependency만 좁게 받는다.
  - 인증/권한 확인과 저장 호출 같은 usecase flow를 조율한다.
  - ticket 생성 규칙, 만료 계산, 저장 record 생성 규칙을 직접 펼치지 않는다.

domain service/function
  - gateway ticket 발급 규칙에 이름을 준다.
  - ticket value, hash, issuedAt, expiresAt을 하나의 domain result로 만든다.
  - 저장 record 또는 response로 변환할 때 경계 지식이 과도하게 섞이지 않도록 주의한다.

domain data
  - IssuedGatewayTicket 같은 불변 값으로 발급 결과를 표현한다.
  - raw ticket과 ticket hash의 의미를 분명히 구분한다.
```

## 예시 방향

아래는 구현안이 아니라 읽히는 형태의 기준입니다.

```ts
const issuedTicket = await gatewayTicketIssuer.issue({
  actorId,
  workspaceId,
  issuedAt: now(),
});

await saveGatewayTicket(toStoredGatewayTicket(issuedTicket));

return issued(toIssueGatewayTicketResponse(issuedTicket, gatewayUrl));
```

중요한 점은 class를 쓰느냐 function을 쓰느냐가 아니라, usecase 본문이 다음 문장으로 읽히는 것입니다.

```txt
권한을 확인한다.
도메인에 ticket 발급을 위임한다.
발급 결과를 저장한다.
응답을 반환한다.
```

## 수정 방향 코드 스케치

아래 코드는 현재 구현을 바로 대체하는 완성안이 아니라, 어떤 모양으로 책임을 나누면 읽히는지 보여주는 스케치입니다.

핵심은 다음입니다.

- usecase는 HTTP DTO나 전체 runtime deps를 직접 받지 않습니다.
- usecase dependency는 필요한 것만 좁게 받습니다.
- 필수 port는 optional fallback으로 숨기지 않습니다.
- ticket 발급 규칙은 domain function/service로 위임합니다.
- usecase는 authorization status를 열어보고 분기하지 않습니다.
- `gatewayUrl`처럼 ticket 발급 응답에 필요한 서버 설정은 optional로 흡수하지 않고 조립 단계에서 필수 검증합니다.
- `Result`는 business rejection을 표현하고, 조립 오류는 factory/mount 단계에서 먼저 실패시킵니다.

```ts
type IssueGatewayTicketCommand = {
  actorId: UserId;
  workspaceId?: WorkspaceId;
};

declare const authorizedGatewayTicketIssueBrand: unique symbol;

type AuthorizedGatewayTicketIssue = IssueGatewayTicketCommand & {
  readonly [authorizedGatewayTicketIssueBrand]: true;
};

type GatewayTicketIssue = {
  commit: (deps: {
    saveGatewayTicket: (ticket: StoredGatewayTicket) => Promise<void>;
  }) => Promise<void>;
  toResult: (input: { gatewayUrl: string }) => IssueGatewayTicketResult;
};

type IssueAuthorizedGatewayTicket = (
  issue: AuthorizedGatewayTicketIssue,
) => Promise<GatewayTicketIssue>;

type IssueGatewayTicketUsecaseDeps = {
  authorizeGatewayTicketIssue: (
    command: IssueGatewayTicketCommand,
    next: IssueAuthorizedGatewayTicket,
  ) => Promise<GatewayTicketIssue>;
  issueAuthorizedGatewayTicket: IssueAuthorizedGatewayTicket;
  saveGatewayTicket: (ticket: StoredGatewayTicket) => Promise<void>;
  gatewayUrl: string;
};

async function issueGatewayTicket(
  command: IssueGatewayTicketCommand,
  deps: IssueGatewayTicketUsecaseDeps,
): Promise<IssueGatewayTicketResult> {
  const {
    authorizeGatewayTicketIssue,
    issueAuthorizedGatewayTicket,
    saveGatewayTicket,
    gatewayUrl,
  } = deps;

  const ticketIssue = await authorizeGatewayTicketIssue(command, issueAuthorizedGatewayTicket);

  await ticketIssue.commit({ saveGatewayTicket });

  return ticketIssue.toResult({ gatewayUrl });
}
```

도메인 쪽은 ticket 발급 규칙에 이름을 줍니다.

```ts
type IssueGatewayTicketDomainDeps = {
  issuedAt: Date;
  ticketTtlSeconds: number;
  generateId: (scope: string) => string;
  hashTicket: (ticketValue: string) => string | Promise<string>;
};

type IssuedGatewayTicket = {
  ticketValue: GatewayTicket;
  ticketValueHash: string;
  actorId: UserId;
  workspaceId?: WorkspaceId;
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
};

async function issueGatewayTicketDomain(
  issue: AuthorizedGatewayTicketIssue,
  deps: IssueGatewayTicketDomainDeps,
): Promise<IssuedGatewayTicket> {
  const { actorId, workspaceId } = issue;
  const { issuedAt, ticketTtlSeconds, generateId, hashTicket } = deps;

  const ticketValue = createGatewayTicketValue({
    ticketId: generateId("gateway-ticket"),
    secret: generateId("gateway-ticket-secret"),
  });

  const expiresAt = calculateGatewayTicketExpiresAt({
    issuedAt,
    ttlSeconds: ticketTtlSeconds,
  });

  return {
    ticketValue,
    ticketValueHash: await hashTicket(ticketValue),
    actorId,
    ...(workspaceId ? { workspaceId } : {}),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}
```

저장 record와 response 변환은 `GatewayTicketIssue` 내부로 캡슐화합니다. usecase는 issued/rejected 여부를 알지 않고 `commit`과 `toResult`만 호출합니다.

```ts
function issuedGatewayTicketIssue(ticket: IssuedGatewayTicket): GatewayTicketIssue {
  return {
    commit: async ({ saveGatewayTicket }) => {
      await saveGatewayTicket({
        ticketValueHash: ticket.ticketValueHash,
        actorId: ticket.actorId,
        ...(ticket.workspaceId ? { workspaceId: ticket.workspaceId } : {}),
        issuedAt: ticket.issuedAt,
        expiresAt: ticket.expiresAt,
      });
    },
    toResult: ({ gatewayUrl }) =>
      issued({
        ticket: ticket.ticketValue,
        gatewayUrl,
        expiresAt: ticket.expiresAt,
      }),
  };
}

function rejectedGatewayTicketIssue(rejection: {
  reason: RealtimeChatErrorCode;
  message?: string;
}): GatewayTicketIssue {
  return {
    commit: async () => undefined,
    toResult: () => rejected(rejection),
  };
}
```

composition/factory 단계는 필수 dependency와 설정값을 먼저 검증합니다. 이 단계에서 실패해야 할 문제를 usecase의 optional fallback으로 넘기지 않습니다.

```ts
function createIssueGatewayTicketUsecaseDeps(
  runtimeDeps: RealtimeChatApiRuntimeDeps,
  options: RealtimeChatApiMountOptions,
): IssueGatewayTicketUsecaseDeps {
  if (!runtimeDeps.permissionPort.canIssueGatewayTicket) {
    throw new Error("canIssueGatewayTicket permission port is required");
  }

  const ticketTtlSeconds = options.gatewayTicketTtlSeconds ?? 60;

  if (!Number.isFinite(ticketTtlSeconds) || ticketTtlSeconds <= 0) {
    throw new Error("gatewayTicketTtlSeconds must be a positive number");
  }

  const gatewayUrl = options.gatewayUrl?.trim();

  if (!gatewayUrl) {
    throw new Error("gatewayUrl is required");
  }

  return {
    authorizeGatewayTicketIssue: async (command, next) => {
      const permission = await runtimeDeps.permissionPort.canIssueGatewayTicket(command);

      if (!permission.allowed) {
        return rejectedGatewayTicketIssue({
          reason: permission.reason,
          ...(permission.message ? { message: permission.message } : {}),
        });
      }

      return next(toAuthorizedGatewayTicketIssue(command));
    },
    issueAuthorizedGatewayTicket: async (issue) => {
      const issuedTicket = await issueGatewayTicketDomain(issue, {
        issuedAt: runtimeDeps.clock.now(),
        ticketTtlSeconds,
        generateId: runtimeDeps.idGenerator.generateId,
        hashTicket: runtimeDeps.ticketHasher?.hash ?? defaultTicketHasher.hash,
      });

      return issuedGatewayTicketIssue(issuedTicket);
    },
    saveGatewayTicket: runtimeDeps.db.issueGatewayTicket,
    gatewayUrl,
  };
}
```

```ts
function toAuthorizedGatewayTicketIssue(
  command: IssueGatewayTicketCommand,
): AuthorizedGatewayTicketIssue {
  return command as AuthorizedGatewayTicketIssue;
}
```

이 형태에서 내결함성은 usecase 내부의 무조건 fallback이 아니라, 조립 단계에서 명시적으로 결정됩니다. `defaultTicketHasher`처럼 package의 공식 기본 정책으로 인정한 항목만 factory에서 보정하고, 권한 port 누락이나 `gatewayUrl` 누락처럼 정책을 무너뜨리는 문제는 즉시 실패시킵니다.

권한 확인도 단순 boolean guard로 소비하지 않습니다. `authorizeGatewayTicketIssue`는 거절이면 `rejectedGatewayTicketIssue`를 반환하고, 허용이면 `AuthorizedGatewayTicketIssue`를 다음 발급 함수에 전달합니다. usecase는 `status`를 열어보지 않으며, 발급/거절에 따른 저장 여부와 Result 변환은 `GatewayTicketIssue` 내부 구현에 위임합니다. 이후 domain 발급 함수는 일반 command가 아니라 authorized issue만 받으므로, 권한 확인을 통과했다는 사실이 타입과 값으로 남습니다.

TypeScript는 구조적 타입 시스템이므로 다음처럼 단순 alias만 두면 필드 재선언은 줄지만 compile-time 경계는 생기지 않습니다.

```ts
type AuthorizedGatewayTicketIssue = IssueGatewayTicketCommand;
```

단순 의미 alias가 목적이면 이 형태도 충분합니다. 하지만 domain 함수가 권한 확인 전 command를 받지 못하게 하려면 branded alias처럼 같은 shape를 재사용하면서도 별도 타입으로 구분해야 합니다.

## 같이 정리할 문제

- usecase가 `RealtimeChatApiRuntimeDeps` 전체를 받지 말고 필요한 dependency만 좁게 받아야 합니다.
- `deps`, `options`, `request` 같은 넓은 이름보다 `actorId`, `authorizeGatewayTicketIssue`, `issueAuthorizedGatewayTicket`, `saveGatewayTicket`, `gatewayUrl`처럼 usecase flow에 필요한 이름이 직접 보여야 합니다.
- HTTP DTO를 usecase 입력으로 그대로 쓰는 구조는 business command와 transport DTO 경계를 흐립니다.
- optional spread 반복은 작은 문제처럼 보이지만, workspace 포함 규칙이 객체 조립 문법으로 반복된다는 점에서 도메인 문장을 흐립니다.

## 내결함성 적용 위치

현재 구조에서 또 하나의 큰 문제는 package 내부 usecase가 너무 많은 것을 견디려 한다는 점입니다. 내결함성은 시스템 일부가 실패하거나 불완전해도 가능한 범위에서 동작을 이어가는 성질입니다. 이 성질은 UI에서는 중요할 수 있습니다. UI는 일부 이미지, 위젯, 네트워크 요청이 실패해도 사용자의 작업을 보호하고 복구 경로를 제공해야 하기 때문입니다.

하지만 server-side business logic package에서 필수 계약 위반까지 견디면 resilience가 아니라 계약 위반 은폐가 됩니다. 서버 비즈니스 로직은 잘못된 조립과 잘못된 설정을 가능한 한 빨리 실패시켜야 합니다.

예를 들어 gateway ticket 발급에서 권한 확인 port가 없을 때 기본 허용으로 진행하는 것은 단순 편의 fallback이 아닙니다. 권한 확인은 ticket 발급 정책의 일부이므로, 해당 정책이 필수라면 usecase에 도달하기 전에 composition 또는 mount 단계에서 실패해야 합니다. 여기까지 온 뒤 `allowed`로 흡수하면 설정 오류와 정책적 허용이 구분되지 않습니다.

`gatewayUrl`도 같은 기준을 적용합니다. gateway ticket 발급 응답이 클라이언트에게 gateway 접속 정보를 제공해야 한다면, `gatewayUrl` 누락은 optional response 변형이 아니라 서버 조립 실패입니다. 이 경우 응답에서 `gatewayUrl`을 조용히 빼는 것이 아니라 mount/factory 단계에서 즉시 실패해야 합니다.

`Result`와 `port`를 두는 이유도 이 지점과 연결됩니다.

```txt
port
  - 외부 세계와 만나는 명시적 경계입니다.
  - 외부 실패, 도메인 거절, 사용 불가 상태를 의미 있는 값이나 예외 정책으로 구분합니다.
  - 필수 dependency 누락 같은 조립 오류를 정상 business flow로 숨기지 않습니다.

Result
  - business success/rejection을 호출자가 명시적으로 분기하게 합니다.
  - 예외나 optional fallback으로 실패 의미를 흐리지 않습니다.
```

따라서 다음 실패 종류를 구분해야 합니다.

```txt
business rejection
  - 정상적인 도메인 결과입니다.
  - 예: actor가 gateway ticket 발급 권한이 없음
  - usecase Result로 반환합니다.

programmer/composition error
  - 시스템 조립 또는 설정 오류입니다.
  - 예: 필수 permission port 누락, gatewayUrl 누락, 잘못된 TTL 설정
  - mount/factory/composition 단계에서 실패시킵니다.

invalid external input
  - transport 경계에서 들어온 잘못된 입력입니다.
  - 예: 인증된 actor context 없음, request body 모양 오류
  - handler/schema 단계에서 HTTP 오류로 변환합니다.

infrastructure failure
  - 외부 시스템 호출 실패입니다.
  - 예: DB 저장 실패, API client 통신 실패
  - 별도 실패 정책을 정하되 조용히 성공으로 바꾸지 않습니다.
```

서버 비즈니스 로직에서 좋은 실패 처리는 실패를 숨기는 것이 아니라 실패 종류를 잃지 않는 것입니다. 예를 들어 outbound publish 실패가 이미 저장된 message accepted response를 막지 않는 것은 명시적으로 선택한 best-effort 정책일 수 있습니다. 반대로 필수 권한 확인 port가 없는데 ticket 발급을 허용하거나, `gatewayUrl`이 없는데 응답을 축소하는 것은 fail-open/fail-soft이며, business package 내부에서 조용히 처리하면 안 되는 문제입니다.

정리하면 UI와 서버의 기준을 분리합니다.

```txt
UI
  - 사용자의 작업을 보호하기 위해 가능한 복구합니다.
  - 일부 실패를 placeholder, retry, 안내 상태로 표현할 수 있습니다.

server business logic
  - 잘못된 조립과 설정을 즉시 실패시킵니다.
  - optional은 진짜 선택 기능일 때만 둡니다.
  - 필수 정책, 필수 설정, 필수 port 누락은 fallback하지 않습니다.
```

정리하면 다음 원칙을 둡니다.

```txt
port를 둔 이유는 경계를 명시하기 위해서입니다.
Result를 둔 이유는 실패를 명시하기 위해서입니다.
optional fallback으로 경계 실패와 조립 실패를 숨기면 둘 다 장식이 됩니다.
```
