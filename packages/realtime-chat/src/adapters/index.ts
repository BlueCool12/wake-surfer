/**
 * realtime-chat adapter들의 public barrel이다.
 *
 * 현재는 외부 솔루션 없이 시작하기 위한 adapter와 provider-neutral RDB 경계 adapter를
 * 모아 둔다. package root public API는 이 barrel을 내보내지 않는다.
 */
export * from './in-memory'
export * from './rdb'
