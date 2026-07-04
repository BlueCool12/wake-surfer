# AGENTS.md (apps/web)

> `apps/web` 전용 가이드입니다. 브랜치·커밋 규칙 등 저장소 전역 규칙은 루트 [AGENTS.md](../../AGENTS.md)를 따릅니다.

## 개요

wake-surfer의 프론트엔드. React 19 + Vite + TypeScript 기반 SPA.

## 라우팅

- `react-router-dom`의 `createBrowserRouter` / `RouterProvider`를 사용한다.
- 라우트 정의는 `src/routes.tsx` 한 곳에 배열로 모은다. 개별 페이지 안에 `<Routes>`를 두지 않는다.
- 코드 스플리팅(`route.lazy`)은 기본 적용하지 않는다. 로그인 등 인증/공개 라우트는 항상 메인 번들에 남긴다(초기 진입 화면이라 분리 이득이 없음). 채팅방 등 무거운 의존성(WebRTC, 에디터 등)을 갖는 라우트가 생기면 그때 해당 라우트만 `lazy`로 전환한다.

## 디렉터리 구조

- `src/pages/`: 라우트에 매핑되는 페이지 컴포넌트. 페이지가 단순하면 `PageName.tsx` 플랫 파일로 두고, 전용 훅·하위 컴포넌트·테스트가 생기면 `PageName/` 폴더로 승격한다.
- 페이지는 얇게 유지한다. 인증 상태, 소켓 연결 등 실제 도메인 로직은 `src/features/<domain>/` (예: `features/auth`, `features/chat`)에 두고, 페이지는 그걸 조립해 라우트에 연결하는 역할만 한다.

## 스타일링

- Tailwind CSS나 컴포넌트 라이브러리(shadcn/ui 등)는 의도적으로 사용하지 않는다. 아직 디자인 시스템/브랜드가 정해지지 않아 도입이 이르다고 판단.
- CSS Modules(`ComponentName.module.css`)를 컴포넌트 옆에 둔다.
- 여러 컴포넌트가 공유하는 값(색상, 간격 등)은 `src/index.css`의 `:root`에 CSS 변수로 정의하고 각 모듈에서 `var(--...)`로 참조한다.

## 환경 변수

- Vite 규칙에 따라 `VITE_` 접두사를 붙이고 `import.meta.env`로 읽는다.
- 새 환경 변수를 추가하면 `.env.example`에도 예시 값을 함께 추가한다.

## 기타

- `tsconfig.app.json` / `tsconfig.node.json`은 루트 `tsconfig.base.json`을 extends한다. 별도로 깨지 않는다.
- 린트/포맷은 루트 설정을 그대로 쓴다 (`pnpm lint`, `pnpm format:check`). oxlint 등 앱 전용 린터를 추가로 들이지 않는다.
- 개발/빌드는 루트에서 `pnpm --filter web dev`, `pnpm --filter web build`로 실행한다.
