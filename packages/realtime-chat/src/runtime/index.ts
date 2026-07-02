/**
 * realtime-chat runtime public barrel이다.
 *
 * runtime 계층은 app shell이 package가 제공하는 실행 가능한 연결 단위를 mount할 수
 * 있게 하는 표면이다. 이 파일은 runtime factory와 관련 타입을 재export만 한다.
 */
export {
  createGatewayDeliveryRuntime,
  type GatewayDeliveryError,
  type GatewayDeliveryRuntime,
  type GatewayDeliveryRuntimeOptions,
} from './gateway-delivery-runtime'
