# Read Cursor 구현 계획: 이슈 카탈로그

> [구현 index](./README.md) | [설계 index](../design/README.md)

| ID | 이슈 제목 | 종류 | 주요 결과 | 직접 선행 |
| --- | --- | --- | --- | --- |
| RCI-01 | Read Cursor 공개 계약 정의 | feat | mark/read-state schema와 wire 의미 | SMI-01 |
| RCI-02 | Table contract와 database migration 합성 | feat | `read_cursors`, feature package 기반, migration | RCI-01, SMI-03, SMI-23 |
| RCI-03 | Mark Read Cursor Command 구현 | feat | atomic monotonic upsert Handler | RCI-01~02, SMI-03 |
| RCI-04 | Get Channel Read State Query 구현 | feat | effective cursor와 `hasUnread` | RCI-01~02 |
| RCI-05 | 사람 identity·channel authorization adapter | feat/security | trusted human user와 authorize-before-data | RCI-02, DEP-AUTH-01, DEP-CH-01 |
| RCI-06 | Internal mark API 구현 | feat | 인증 Gateway actor assertion과 package mount | RCI-03, RCI-05, SMI-06, SMI-20 |
| RCI-07 | Public read-state HTTP API 구현 | feat | 인증 사용자 조회 route와 package mount | RCI-04~05, SMI-06, DEP-AUTH-01 |
| RCI-08 | Gateway WebSocket mark relay 구현 | feat | requester-only command/result relay | RCI-06, SMI-21 |
| RCI-09 | Web read observation 상태 모델 구현 | feat | active/visible/merged/contiguous read state | RCI-01, SMI-13 |
| RCI-10 | Web Read Cursor transport 구현 | feat | mark WS와 read-state HTTP client | RCI-07~09, SMI-15, SMI-22 |
| RCI-11 | Chat 화면 읽음 lifecycle 연결 | feat | latest baseline, gap, sender mark, unread badge | RCI-10, SMI-16 |
| RCI-12 | Read Cursor 분산 rate limit 구현 | feat/security | mark/query abuse 보호 | RCI-06~08, SMI-25 |
| RCI-13 | 생산자·소비자 계약 적합성 검증 | test | API/Gateway/Web golden fixture | RCI-06~10, RCI-12 |
| RCI-14 | API–Gateway–PostgreSQL E2E 검증 | test | 실제 process/DB 권한·경쟁·복구 검증 | RCI-02, RCI-06~08, SMI-03 |
| RCI-15 | 관측성·운영 계약·공개 문서 마감 | feat/docs | 로그, 운영 대응, public docs | RCI-11~14 |
