import Spinner from "./Spinner";
import styles from "./Loading.module.css";

type LoadingProps = {  
  label?: string;
};

function Loading({ label }: LoadingProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <Spinner />
      <span className={label === undefined ? styles.srOnly : styles.label}>
        {label ?? "불러오는 중…"}
      </span>
    </div>
  );
}

export default Loading;
