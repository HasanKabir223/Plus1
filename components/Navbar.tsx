"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <nav
      className={`${styles.nav} ${isLanding ? styles.navDark : ""}`}
      id="navbar"
    >
      <div className={styles.inner}>
        <Link href="/" className={styles.logo} aria-label="Plus1 home">
          <span className={styles.logoIcon}>
            <Image
              src="/logo.png"
              alt="Plus1 logo"
              width={28}
              height={28}
              className={styles.logoImg}
            />
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
            <Link href="/home" className={styles.homeLink}>
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
