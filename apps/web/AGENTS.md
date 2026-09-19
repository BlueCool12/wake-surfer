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

- Tailwind CSS나 컴포넌트 라이브러리(shadcn/ui 등)는 의도적으로 사용하지 않는다. 브랜드가 확정되지 않은 단계에서 남의 디자인 시스템을 먼저 들이면 나중에 걷어내는 비용이 크고, 일관성은 아래 CSS 변수 토큰 레이어로 충분히 확보된다고 판단.
- CSS Modules(`ComponentName.module.css`)를 컴포넌트 옆에 둔다.
- 색상·간격·타이포·radius·shadow는 `src/index.css`의 `:root`에 디자인 토큰으로 정의하고, 각 모듈은 `var(--...)`로만 참조한다. `.module.css`에 hex/rgba/`rem` 리터럴을 직접 쓰지 않는다.
  - `--color-*`: 의미 기반으로 이름 짓는다(`--color-danger`이지 `--color-red`가 아니다). 다크 모드에서 값이 달라져야 하는 토큰은 `@media (prefers-color-scheme: dark)` 블록에 반드시 오버라이드를 넣는다. 특히 오버레이(`--color-overlay-hover`)처럼 `rgba(0,0,0,...)`로 두면 다크에서 안 보이는 값들을 빠뜨리지 않는다.
  - `--space-*`: 4px(0.25rem) 그리드. 숫자는 4px 배수를 뜻한다(`--space-3` = 0.75rem = 12px). 새 값이 필요하면 그리드에 스냅하고, 그리드 밖 값을 토큰으로 추가하지 않는다.
  - `--font-size-*`: `2xs`~`xl` 스케일. 중간값이 필요해 보이면 먼저 기존 단계로 대체할 수 있는지 검토한다.
  - `--radius-*`: `sm`/`md`/`lg`/`xl`/`full`. 원형은 `50%` 대신 `--radius-full`을 쓴다.
  - 토큰 스케일에 속하지 않는 값(예: 특정 요소의 `max-width: 8rem`)은 리터럴로 둔다. 한 곳에서만 쓰는 제약을 억지로 토큰화하지 않는다.
  - GitHub 버튼처럼 외부 브랜드가 색을 강제하는 경우만 예외로 브랜드 토큰(`--color-github*`)을 따로 두고, 의미 토큰과 섞지 않는다.
- 레이아웃은 컴포넌트 내부(정렬, 간격, 아이콘+텍스트 배치 등)는 flex를 기본으로 쓴다. 페이지를 사이드바/메인 영역처럼 여러 구획으로 나누는 2차원 레이아웃이 필요해지면 그때 grid를 쓴다.

## 반응형

- 고정폭 + 미디어 쿼리보다 유동폭(`width: 100%`) + `max-width` 제한을 기본으로 사용한다. 카드형 레이아웃처럼 단순한 화면은 이 방식만으로 모바일부터 데스크톱까지 별도 breakpoint 없이 대응된다.
- 미디어 쿼리는 레이아웃 자체가 달라져야 할 때만 추가한다 (예: 좁은 화면에서 세로 스택 → 넓은 화면에서 사이드바 2단 구성).

## 에셋 관리

- 범용 UI 아이콘(전송, 첨부, 닫기 등)은 `lucide-react`를 쓴다. `import { Send } from "lucide-react"` → `<Send size={18} />`. 아이콘별로 트리셰이킹되고 `currentColor`로 색을 상속하니 부모의 `color`로 제어한다. (아이콘 라이브러리는 디자인 시스템을 강제하지 않으므로 "컴포넌트 라이브러리 미사용" 방침과 무관하다.)
- 브랜드 로고(GitHub 등 lucide에 없는 마크)는 React 컴포넌트로 직접 만들어 해당 컴포넌트 옆에 둔다 (예: `pages/LoginPage/GithubIcon.tsx`). 색을 상속시키려면 `fill="currentColor"`를 쓴다. `<img>`나 `public/`으로 두지 않는다.
- 사진처럼 코드가 내용을 몰라도 되는 이미지는 `src/assets/`에 두고 `import`해서 쓴다. Vite가 빌드 시 해시를 붙여 최적화한다.
- 파일명·경로가 고정되어야 하는 것(favicon, `robots.txt` 등)만 `public/`에 둔다.

## 환경 변수

- Vite 규칙에 따라 `VITE_` 접두사를 붙이고 `import.meta.env`로 읽는다.
- 새 환경 변수를 추가하면 `.env.example`에도 예시 값을 함께 추가한다.

## 기타

- `tsconfig.app.json` / `tsconfig.node.json`은 루트 `tsconfig.base.json`을 extends한다. 별도로 깨지 않는다.
- 린트/포맷은 루트 설정을 그대로 쓴다 (`pnpm lint`, `pnpm format:check`). oxlint 등 앱 전용 린터를 추가로 들이지 않는다.
- 개발/빌드는 루트에서 `pnpm exec turbo run dev --filter=web`,
  `pnpm exec turbo run build --filter=web`으로 실행한다.
- container 계약과 Nginx 설정은 `docker/`가 소유한다. Vite build는 Docker 밖에서 완료하며,
  Dockerfile은 사전 생성된 로컬 정적 artifact만 Nginx image에 복사한다.
