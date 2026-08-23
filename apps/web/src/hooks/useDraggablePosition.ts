import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

export type DraggablePosition = { left: number; top: number };

export type UseDraggablePositionResult = {
  /** 뷰포트 기준 좌표. 시작 위치를 아직 계산하지 못했으면 `undefined`. */
  position: DraggablePosition | undefined;
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * `position: fixed` 요소를 화면 어디로든 끌어 옮긴다.
 *
 * 시작 위치는 `anchorRef` 요소의 우측 하단이다. 옮긴 위치는 저장하지 않으므로 다시 열면 늘 같은
 * 자리에서 시작한다.
 *
 * 좌표는 뷰포트 기준이라 포인터 좌표(`clientX`/`clientY`)를 그대로 쓸 수 있다. 다만 창이 작아지면
 * 화면 밖으로 나갈 수 있어 리사이즈마다 다시 가둔다.
 *
 * 버튼 위에서 시작한 포인터는 드래그로 보지 않는다. 그러지 않으면 음소거·나가기를 누를 수 없다.
 */
export function useDraggablePosition(options: {
  ref: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  /** 앵커 모서리에서 띄울 여백(px). */
  inset?: number;
}): UseDraggablePositionResult {
  const { ref, anchorRef, inset = 16 } = options;
  const [position, setPosition] = useState<DraggablePosition | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const grabOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** 화면 가장자리에 딱 붙지 않도록 `inset`만큼 여백을 두고 가둔다. */
  const clampToViewport = useCallback(
    (next: DraggablePosition): DraggablePosition => {
      const element = ref.current;

      if (element === null) return next;

      return {
        left: clamp(
          next.left,
          inset,
          Math.max(inset, window.innerWidth - element.offsetWidth - inset),
        ),
        top: clamp(
          next.top,
          inset,
          Math.max(inset, window.innerHeight - element.offsetHeight - inset),
        ),
      };
    },
    [inset, ref],
  );

  // 그리기 전에 좌표를 정해, 기본 위치에서 시작 위치로 튀는 것을 막는다.
  useLayoutEffect(() => {
    if (position !== undefined) return;

    const element = ref.current;
    const anchor = anchorRef.current;

    if (element === null || anchor === null) return;

    const bounds = anchor.getBoundingClientRect();
    setPosition(
      clampToViewport({
        left: bounds.right - element.offsetWidth - inset,
        top: bounds.bottom - element.offsetHeight - inset,
      }),
    );
  }, [anchorRef, clampToViewport, inset, position, ref]);

  /**
   * 화면이나 요소 크기가 바뀌면 다시 화면 안으로 가둔다.
   *
   * 요소 쪽도 봐야 하는 이유는, 통화 참가자가 늘면 라벨이 길어져 폭이 커지기 때문이다. 좌표는
   * 좌상단 기준이라 폭만 커지면 오른쪽이 화면 밖으로 밀려난다.
   *
   * 값이 그대로면 **같은 객체를 돌려준다**. 매번 새 객체를 만들면 상태가 바뀐 것으로 취급돼
   * 리렌더 → 옵저버 재등록 → 콜백 → 리렌더로 끝없이 돈다.
   */
  useEffect(() => {
    const element = ref.current;

    if (position === undefined || element === null) return;

    const keepInView = () =>
      setPosition((current) => {
        if (current === undefined) return current;

        const clamped = clampToViewport(current);
        return clamped.left === current.left && clamped.top === current.top ? current : clamped;
      });

    const observer = new ResizeObserver(keepInView);
    observer.observe(element);
    window.addEventListener("resize", keepInView);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepInView);
    };
  }, [clampToViewport, position, ref]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const element = ref.current;
    if (element === null) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;

    const rect = element.getBoundingClientRect();
    grabOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    element.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isDragging || ref.current === null) return;

    setPosition(
      clampToViewport({
        left: event.clientX - grabOffset.current.x,
        top: event.clientY - grabOffset.current.y,
      }),
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isDragging) return;

    ref.current?.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  };

  return { position, isDragging, onPointerDown, onPointerMove, onPointerUp };
}
