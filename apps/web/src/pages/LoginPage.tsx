const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

function LoginPage() {
  const handleGithubLogin = () => {
    window.location.href = `${apiBaseUrl}/auth/github`;
  };

  return (
    <div>
      <h1>로그인</h1>
      <button type="button" onClick={handleGithubLogin}>
        GitHub로 로그인
      </button>
    </div>
  );
}

export default LoginPage;
