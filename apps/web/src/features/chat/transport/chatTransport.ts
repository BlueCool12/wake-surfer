import type {
  ChannelId,
  ClientMessageId,
  MessageAcceptedResponse,
  MessageRejectedResponse,
  PublicMessageDto,
  TextMessageContentDto,
} from "../contracts";

/**
 * 프론트가 채팅방 하나와 실시간으로 주고받는 것을 추상화한 seam.
 *
 * 지금은 목 구현(mockChatTransport)만 있다. 백엔드가 붙으면
 * 아래 흐름을 그대로 감싸는 실제 구현으로 교체한다:
 *   1. POST /gateway-tickets 로 티켓 발급
 *   2. gatewayUrl 로 WebSocket 연결 (gateway.connected 대기)
 *   3. chat.stream.sync → chat.stream.synced 로 히스토리 로드
 *   4. chat.channel.message.send → chat.message.accepted / rejected → chat.message.created
 *
 * 인터페이스는 소켓/HTTP 세부를 숨기고 채팅방 화면이 필요한 것만 노출한다.
 */
export interface ChatTransport {
  /** 게이트웨이 연결. 실제 구현에선 티켓 발급 + 소켓 연결. */
  connect(): Promise<void>;

  /** 연결 해제. 화면 언마운트 시 호출. */
  disconnect(): void;

  /** 스트림 히스토리 로드 (오래된 → 최신 순으로 정렬해 반환). */
  loadHistory(): Promise<PublicMessageDto[]>;

  /**
   * 채널 메시지 전송. 결과는 즉시 반환하지 않고
   * onMessageAccepted / onMessageRejected 이벤트로 전달된다.
   * clientMessageId 로 낙관적 UI 항목과 서버 응답을 잇는다.
   */
  sendChannelMessage(params: {
    clientMessageId: ClientMessageId;
    content: TextMessageContentDto;
  }): void;

  /** 서버가 확정 저장한 메시지(내 것 + 남의 것) 브로드캐스트. */
  onMessageCreated(listener: (message: PublicMessageDto) => void): () => void;

  /** 내 전송이 수락됨 (clientMessageId ↔ 확정 messageId/sequence 매핑). */
  onMessageAccepted(listener: (response: MessageAcceptedResponse) => void): () => void;

  /** 내 전송이 거부됨. */
  onMessageRejected(listener: (response: MessageRejectedResponse) => void): () => void;
}

export type ChatTransportContext = {
  channelId: ChannelId;
};
