"use client";

import styles from "./Ticker.module.css";

const items = [
  "Less searching",
  "More introductions",
  "Human agency, kept",
  "Built for real people",
];

export default function Ticker() {
  return (
    <div className={styles.ticker} aria-hidden="true">
      <div className={styles.track}>
        {[...items, ...items, ...items].map((item, i) => (
          <span key={i} className={styles.item}>
            {item}
            <span className={styles.sep}>/</span>
          </span>
        ))}
      </div>
    </div>
  );
}
