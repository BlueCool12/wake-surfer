import styles from "./Spinner.module.css";

type SpinnerProps = {
  size?: number;
};

function Spinner({ size }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      aria-hidden="true"
      style={size === undefined ? undefined : { width: size, height: size }}
    />
  );
}

export default Spinner;
