import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse)";

/** 주 입력 장치가 손가락인지. 인라인 아이콘 대신 액션 시트를 띄우는 것처럼 동작 자체가 갈릴 때만 쓴다. */
function useIsCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(QUERY);
    const sync = () => setIsCoarsePointer(mediaQuery.matches);

    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  return isCoarsePointer;
}

export default useIsCoarsePointer;
