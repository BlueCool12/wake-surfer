/**
 * 메인 API 서버군이 클라이언트에게 게이트웨이 접속 티켓을 발급하는 유스케이스를
 * 정의한다.
 *
 * 이 파일은 "인증이 끝난 사용자가 어느 gateway에 접속할 수 있는 티켓을 받는다"는
 * 실행 흐름만 소유한다. 사용자 인증 자체, gateway 부하 분산 정책, 티켓 저장 방식은
 * 이 유스케이스의 책임이 아니다.
 */
import type { GatewayTicket, IssueGatewayTicketInput } from '../contract'
import type { GatewayTicketPort } from '../ports'

export type IssueGatewayTicketUseCase = {
  /**
   * gateway 접속 티켓을 발급한다.
   *
   * 호출자는 이미 인증된 userId와 배정된 gatewayId, TTL을 넘겨야 한다. 이 유스케이스는
   * 입력을 그대로 `GatewayTicketPort`에 위임해 app이 ticket adapter를 직접 알지 않게
   * 한다.
   */
  execute(input: IssueGatewayTicketInput): Promise<GatewayTicket>
}

export type IssueGatewayTicketUseCaseDeps = {
  ticketPort: GatewayTicketPort
}

/**
 * gateway 접속 티켓 발급 유스케이스를 생성한다.
 *
 * 현재는 단일 포트를 호출하는 얇은 workflow지만, app shell이 직접 port를 import해
 * 조합하지 않도록 public use case 표면을 먼저 고정한다. 이후 gateway 선택 기록,
 * audit event, rate limit port가 추가되어도 app handler의 호출 모양은 유지할 수 있다.
 */
export function createIssueGatewayTicketUseCase(
  deps: IssueGatewayTicketUseCaseDeps,
): IssueGatewayTicketUseCase {
  return {
    async execute(input: IssueGatewayTicketInput): Promise<GatewayTicket> {
      return deps.ticketPort.issue(input)
    },
  }
}
