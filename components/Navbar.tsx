"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { user, signOut } = useAuth();

  return (
    <nav className={styles.nav} id="navbar">
      <div className={styles.inner}>
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
          {!user && (
            <li>
              <Link href="/login" className={styles.loginLink}>
                Log in
              </Link>
            </li>
          )}
        </ul>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link href="/home" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>
              Home
            </Link>
            <button
              type="button"
              onClick={() => signOut()}
              className={styles.logoutBtn}
            >
              Log out
            </button>
          </div>
        ) : (
          <Link href="/signup" className={`btn-primary ${styles.ctaBtn}`}>
            Get Started
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
