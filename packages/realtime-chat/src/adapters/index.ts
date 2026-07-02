/**
 * realtime-chat adapter들의 public barrel이다.
 *
 * 현재는 외부 솔루션 없이 시작하기 위해 in-memory/mock adapter만 내보낸다. 이후
 * Redis/Kafka/HTTP/gRPC adapter가 추가되면 이 파일에서 public export 여부를 통제한다.
 */
export * from './in-memory'
