/** 수신 콜백의 예외가 WebSocket 프레임 처리 흐름을 중단하지 않게 한다. */
export function notify(callback: () => void): void {
  queueMicrotask(() => callback());
}
