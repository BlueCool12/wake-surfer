/**
 * API가 수용하는 JSON 요청 본문의 최대 wire 크기다.
 *
 * 대표적인 Message Send 요청에서 8 KiB UTF-8 text가 JSON escape로 확장되는 최악의
 * 경우를 수용하도록 정했으며, 배포 프로필별 설정이 아닌 transport 계약으로 고정한다.
 */
export const MAX_REALTIME_CHAT_REQUEST_BODY_UTF8_BYTES = 65_536;
