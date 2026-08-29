/**
 * 미디어 게이트웨이 접속 정보.
 *
 * 채팅 런타임과 같은 방식으로 앱 진입점이 한 번 설정한다. 통화는 채팅 게이트웨이가 아니라
 * 미디어 게이트웨이에 별도 연결을 맺으므로 주소도 따로 받는다.
 */
let configuredGatewayUrl: string | undefined;

export function configureVoiceRuntime(options: { gatewayUrl: string }): void {
  const gatewayUrl = options.gatewayUrl.trim();

  if (gatewayUrl.length === 0) {
    throw new Error("미디어 게이트웨이 주소가 비어 있습니다.");
  }

  configuredGatewayUrl = gatewayUrl;
}

export function getVoiceGatewayUrl(): string {
  if (configuredGatewayUrl === undefined) {
    throw new Error("음성 runtime이 아직 설정되지 않았습니다.");
  }

  return configuredGatewayUrl;
}
