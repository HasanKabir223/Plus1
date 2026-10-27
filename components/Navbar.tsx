"use client";

import Link from "next/link";
import styles from "./Navbar.module.css";

export default function Navbar() {
  return (
    <nav className={styles.nav} id="navbar">
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.logo} aria-label="Plus1 home">
          <span className={styles.logoIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="var(--agent)" />
              <circle cx="12" cy="12" r="4" fill="var(--ink)" />
            </svg>
          </span>
          <span className={styles.logoText}>Plus1</span>
        </Link>

        <ul className={styles.links}>
          <li>
            <a href="#how-it-works">How it works</a>
          </li>
          <li>
            <a href="#use-cases">Use cases</a>
          </li>
          <li>
            <a href="#trust">Trust</a>
          </li>
          <li>
            <a href="#" className={styles.loginLink}>
              Log in
            </a>
          </li>
        </ul>

        <a href="#" className="btn-primary">
          Create your agent
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </nav>
  );
}
