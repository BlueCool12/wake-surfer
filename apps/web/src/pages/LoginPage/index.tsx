import logo from "../../assets/logo.png";
import GithubIcon from "./GithubIcon";
import styles from "./LoginPage.module.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

function LoginPage() {
  const handleGithubLogin = () => {
    alert("GitHub 로그인 버튼 클릭됨" + apiBaseUrl);
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <img src={logo} alt="" className={styles.logo} />
        <h1 className={styles.title}>WAKE SURFER</h1>
        <p className={styles.subtitle}>실시간 협업의 시작</p>
        <button type="button" className={styles.githubButton} onClick={handleGithubLogin}>
          <GithubIcon />
          GitHub로 로그인
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
