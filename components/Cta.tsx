import Link from "next/link";
import styles from "./Cta.module.css";

export default function Cta() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.inner}>
          <h2 className={`display ${styles.heading}`}>
            Ready to meet the network?
          </h2>
          <p className={styles.sub}>
            Create your profile, shape your agent, and let it do the reaching.
          </p>
          <div className={styles.actions}>
            <Link href="/signup" className="btn-primary">
              Create your agent <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className={styles.note}>
            Free to start. No credit card needed.
          </div>
        </div>
      </div>
    </section>
  );
}
