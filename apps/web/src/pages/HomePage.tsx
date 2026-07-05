import { Link } from "react-router-dom";

function HomePage() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>WAKE SURFER</h1>
      {/* 임시: 채팅방 목록 API가 생기기 전까지 샘플 방으로 진입 */}
      <Link to="/rooms/test">#임시 채팅방 열기 →</Link>
    </div>
  );
}

export default HomePage;
