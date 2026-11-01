import Link from "next/link";
import styles from "./Cta.module.css";

export default function Cta() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.panel}>
          <div className={styles.copy}>
            <span className={styles.chip}>Free to start</span>
            <h2 className={styles.heading}>Ready to meet the network?</h2>
            <p className={styles.sub}>
              Create your profile, shape your agent, and let it do the
              reaching. You stay in control of every introduction.
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/signup" className="btn-primary">
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link href="/login" className={styles.loginLink}>
              I already have an account
            </Link>
            <span className={styles.note}>No credit card needed.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
