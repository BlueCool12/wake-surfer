const LEGACY_IME_PROCESSING_MARKER = 229;

function hasLegacyImeProcessingMarker(event: KeyboardEvent): boolean {
  // 최신 상태는 isComposing으로 판단한다. 229는 브라우저별 IME 이벤트 차이를 위한 호환 fallback이다.
  return event.keyCode === LEGACY_IME_PROCESSING_MARKER;
}

interface ChatComposerKeyDownResult {
  readonly shouldPreventDefault: boolean;
}

interface ChatComposerSubmitController {
  isImeProcessing(event: KeyboardEvent): boolean;
  compositionStarted(): void;
  compositionEnded(): void;
  handleKeyDown(event: KeyboardEvent): ChatComposerKeyDownResult;
  consumeSubmitOnKeyUp(event: KeyboardEvent): boolean;
  cancelPendingSubmit(): void;
}

function createChatComposerSubmitController(): ChatComposerSubmitController {
  let isCompositionTracked = false;
  let hasPendingSubmit = false;

  const isImeProcessing = (event: KeyboardEvent): boolean =>
    isCompositionTracked || event.isComposing || hasLegacyImeProcessingMarker(event);

  return {
    isImeProcessing,
    compositionStarted() {
      isCompositionTracked = true;
    },
    compositionEnded() {
      isCompositionTracked = false;
    },
    handleKeyDown(event) {
      if (event.key !== "Enter" || event.shiftKey) {
        return { shouldPreventDefault: false };
      }

      if (!event.repeat) hasPendingSubmit = true;
      return { shouldPreventDefault: !isImeProcessing(event) };
    },
    consumeSubmitOnKeyUp(event) {
      if (event.key !== "Enter" || !hasPendingSubmit) return false;
      hasPendingSubmit = false;
      return true;
    },
    cancelPendingSubmit() {
      hasPendingSubmit = false;
    },
  };
}

export { createChatComposerSubmitController };
