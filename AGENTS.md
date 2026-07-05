# AGENTS.md

> 이 문서는 AI 코딩 에이전트가 본 저장소에서 작업할 때 따라야 할 프로젝트 전역 가이드입니다.

## 프로젝트 개요

**wake-surfer** — WebSocket, WebRTC, RTMP 등을 활용한 화상 회의 · 실시간 협업 · 페어 프로그래밍 플랫폼.

핵심 도메인:
- **화상 회의**: WebRTC 기반 다자간 영상/음성 통신
- **실시간 협업**: WebSocket 기반 상태 동기화 (커서, 문서, 화이트보드 등)
- **페어 프로그래밍**: 코드 공유 및 동시 편집
- **스트리밍**: RTMP를 통한 송출/중계

## 프로젝트 구조

pnpm workspace 기반 모노레포로 구성합니다.

```
wake-surfer/
├── apps/
│   └── web/          # React 프론트엔드 (Vite)
├── packages/
└── AGENTS.md
```

## 기술 스택

| 영역 | 선택 | 비고 |
| --- | --- | --- |
| 언어 | TypeScript, TBD | 앱/패키지별로 Go/Java 등 추가 가능 |
| 프론트엔드 | React 19 + Vite | `apps/web` |
| 백엔드 / 시그널링 | TBD | |
| 실시간 통신 | WebSocket, WebRTC, RTMP | |
| 패키지 매니저 / 모노레포 | pnpm workspace | |
| 테스트 | TBD | |

## 개발 워크플로우

- 설치: `pnpm install`
- 개발 서버: `pnpm --filter web dev`
- 빌드: `pnpm --filter web build`
- 테스트: `TBD`
- 린트 / 포맷: `pnpm lint`, `pnpm format:check`, `pnpm format`

## 브랜치 & 커밋 규칙

- **기본(default) 브랜치: `dev`** — 통합 브랜치이자 일상 작업의 기준.
- **`main`**: 배포(릴리스) 브랜치. 충분히 테스트된 변경만 반영한다.

**작업 흐름:**
1. GitHub에 이슈를 먼저 작성한다. (작업 단위 = 이슈)
2. `dev`에서 작업 브랜치를 분기한다.
3. 작업 완료 후 PR을 통해 `dev`에 머지한다. (이슈 번호 연결)
4. `dev`에서 충분히 테스트한 뒤 `main`으로 머지하여 배포한다.

### 작업 브랜치 네이밍

`<type>/<issue#>-<slug>` 형식. 이슈 번호를 반드시 포함한다.

```
feat/12-webrtc-signaling
fix/34-cursor-sync
chore/5-monorepo-setup
docs/8-agents-md
```

- `<type>`: 커밋 컨벤션의 type과 동일 (`feat`, `fix`, `chore`, `docs`, `refactor`, `test` 등)
- `<slug>`: 소문자 kebab-case로 작업 요약

### 커밋 메시지 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/) 를 따른다.

```
<type>(<scope>): <subject>
```

```
feat(rtc): add WebRTC peer connection
fix(ws): handle reconnect on connection drop
chore(repo): set up pnpm workspace
docs: write AGENTS.md base
```

- 주요 `type`: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`
- `scope`는 선택. 영향 받는 패키지/모듈 (예: `rtc`, `ws`, `web`, `signaling`)
- breaking change는 `type!` 또는 본문에 `BREAKING CHANGE:` 명시
- 관련 이슈는 본문/푸터에 연결 (예: `Refs #12`, `Closes #12`)

## 코딩 컨벤션

> 스택 확정 후 구체화. 기본 원칙만 명시.

- 기존 코드의 스타일·네이밍·구조를 우선 따른다.
- 공유 가능한 타입·로직은 `packages/`에 두어 앱 간 중복을 피한다.
- 실시간 통신 프로토콜(메시지 포맷, 시그널링 시퀀스)은 공유 패키지에 단일 정의한다.

## 에이전트 작업 지침

- 작업 전 관련 패키지의 로컬 규칙(하위 `AGENTS.md`가 있다면 우선)을 확인한다.
- 기술 스택이 미정인 항목은 임의로 도입하지 말고 사용자에게 확인한다.
- 변경 후에는 해당 워크플로우 명령(빌드/테스트/린트)으로 검증한다.
