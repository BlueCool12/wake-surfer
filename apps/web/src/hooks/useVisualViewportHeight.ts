import { useEffect } from "react";

/**
 * 실제로 보이는 화면 높이를 `--app-height`로 노출한다.
 *
 * 모바일 브라우저는 소프트 키보드가 올라와도 `100dvh`를 줄여주지 않아 입력창이 키보드 뒤로 밀린다.
 * `visualViewport`가 없는 환경에서는 변수를 세팅하지 않고 CSS 의 `100dvh` fallback을 쓴다.
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;

    const syncHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
    };

    syncHeight();
    viewport.addEventListener("resize", syncHeight);

    return () => {
      viewport.removeEventListener("resize", syncHeight);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}

export default useVisualViewportHeight;
