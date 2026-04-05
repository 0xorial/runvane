import styles from "./Spinner.module.css";

type SpinnerProps = {
  size?: number;
  className?: string;
};

export function Spinner({ size = 14, className = "" }: SpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${className}`.trim()}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
