# Runtime Infra Agent Context

이 모듈은 저장소가 공유하는 단일 PostgreSQL·Redis 개발 인스턴스의 Docker 자산만 소유한다.

- 애플리케이션 이미지나 애플리케이션 환경 변수는 소유하지 않는다.
- DB migration은 `packages/realtime-chat-database/docker/`가 소유한다.
- 서비스 이름과 named volume은 다른 모듈에서 중복 정의하지 않는다.
- 외부 공개 포트는 로컬 개발과 host 통합 테스트를 위한 loopback bind로 제한한다.
