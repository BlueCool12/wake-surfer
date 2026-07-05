/**
 * ISO 문자열을 "오후 3:04" 같은 시:분 표기로 변환한다.
 *
 * @param iso - ISO 8601 형식의 날짜/시간 문자열
 * @returns ko-KR 로케일의 시:분 문자열
 */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
