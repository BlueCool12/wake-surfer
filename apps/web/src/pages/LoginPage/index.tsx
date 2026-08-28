import { useSearchParams } from "react-router-dom";

import logo from "../../assets/logo.png";
import GithubIcon from "./GithubIcon";
import styles from "./LoginPage.module.css";
import { loginErrorMessage } from "./loginError";

const LOGIN_ENDPOINT = "/auth/github/login";

function LoginPage() {
  const [searchParams] = useSearchParams();
  const errorMessage = loginErrorMessage(searchParams.get("error"));

  const handleGithubLogin = () => {
    // SPA 라우팅이 아니라 전체 페이지 이동이어야 GitHub으로 리다이렉트된다.
    window.location.href = LOGIN_ENDPOINT;
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <img src={logo} alt="" className={styles.logo} />
        <h1 className={styles.title}>WAKE SURFER</h1>
        <p className={styles.subtitle}>실시간 협업의 시작</p>
        {errorMessage !== null && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        <button type="button" className={styles.githubButton} onClick={handleGithubLogin}>
          <GithubIcon />
          GitHub로 로그인
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
