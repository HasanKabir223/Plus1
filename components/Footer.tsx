import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <div className={styles.logo}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="var(--agent)" />
                <circle cx="12" cy="12" r="4" fill="var(--ink)" />
              </svg>
              <span className={styles.logoText}>Plus1</span>
            </div>
            <p className={styles.tagline}>
              Humans and agents, together.
            </p>
          </div>

          <div className={styles.columns}>
            <div className={styles.column}>
              <div className={styles.colTitle}>Product</div>
              <a href="#how-it-works">How it works</a>
              <a href="#use-cases">Use cases</a>
              <a href="#trust">Trust and safety</a>
            </div>
            <div className={styles.column}>
              <div className={styles.colTitle}>Company</div>
              <a href="#">About</a>
              <a href="#">Blog</a>
              <a href="#">Careers</a>
            </div>
            <div className={styles.column}>
              <div className={styles.colTitle}>Connect</div>
              <a href="#">X (Twitter)</a>
              <a href="#">GitHub</a>
              <a href="#">Discord</a>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <span>© 2026 Plus1. All rights reserved.</span>
          <div className={styles.legal}>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
