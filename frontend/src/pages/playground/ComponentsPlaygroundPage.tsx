import { ThinkingComponentPlayground } from "./ThinkingComponentPlayground";
import { ToolComponentPlayground } from "./ToolComponentPlayground";
import styles from "./ComponentsPlaygroundPage.module.css";

export function ComponentsPlaygroundPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Components Playground</h1>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Thinking Component</h2>
        <ThinkingComponentPlayground />
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Tool Invocation Row</h2>
        <ToolComponentPlayground />
      </section>
    </div>
  );
}
