/**
 * 웹소켓 handshake 전에 발급되는 gateway 접속 티켓의 발급/소비 포트를 정의한다.
 *
 * 이 파일은 티켓이 "짧은 수명의 접속 권한이며 성공 시 1회 소비된다"는 의미를
 * 고정한다. JWT, Redis `GETDEL`, DB nonce 같은 저장/검증 구현은 adapter 책임이다.
 */
import type {
  ConsumeGatewayTicketInput,
  ConsumeGatewayTicketResult,
  GatewayTicket,
  IssueGatewayTicketInput,
} from '../contract'

export type GatewayTicketPort = {
  /**
   * 클라이언트가 웹소켓 게이트웨이에 접속하기 전에 사용할 접속 티켓을 발급한다.
   *
   * 1차 구현은 in-memory adapter로 충분하지만, 이 포트의 의미는 "특정 사용자에게
   * 특정 gateway로 접속할 수 있는 짧은 수명의 권한을 발급한다"는 것이다. 이후
   * Redis, DB, 별도 ticket service로 바뀌더라도 호출자는 같은 계약을 사용한다.
   */
  issue(input: IssueGatewayTicketInput): Promise<GatewayTicket>

  /**
   * 웹소켓 handshake 시점에 티켓을 검증하고 소비한다.
   *
   * 성공한 티켓은 재사용되지 않아야 한다. 구현체는 최소한 존재 여부, 이미 소비됨,
   * 만료, 배정 gateway 불일치를 구분해 반환해야 한다. 이 구분은 gateway app이
   * 실패 원인을 로그로 남기되 제품 정책을 직접 판단하지 않도록 하기 위한 것이다.
   */
  consume(input: ConsumeGatewayTicketInput): Promise<ConsumeGatewayTicketResult>
}
