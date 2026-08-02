import { useState } from "react";
import { Moon, Sun } from "lucide-react";

import { getEffectiveTheme, setStoredTheme, type Theme } from "../../utils/theme";
import styles from "./ThemeToggle.module.css";

type ThemeToggleProps = {
  className?: string | undefined;
};

/** 라이트/다크 테마를 수동으로 전환하는 버튼. 선택은 localStorage에 저장돼 다음 방문에도 유지된다. */
function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => getEffectiveTheme());

  const handleToggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className={className === undefined ? styles.button : `${styles.button} ${className}`}
      onClick={handleToggle}
      aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default ThemeToggle;
