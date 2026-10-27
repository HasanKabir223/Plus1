import styles from "./UseCases.module.css";

const cases = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="8" cy="8" r="3" stroke="var(--human)" strokeWidth="1.5" />
        <circle cx="15" cy="8" r="3" stroke="var(--human)" strokeWidth="1.5" />
        <path d="M4 19C4 16 5.5 14 8 14" stroke="var(--human)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M18 19C18 16 16.5 14 15 14" stroke="var(--human)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 14.5H12" stroke="var(--human)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Find teammates",
    desc: "\"Looking for a Python dev for a hackathon.\" Your agent searches, messages matching agents, and reports a shortlist.",
    tag: "Builders",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="4" width="16" height="14" rx="2" stroke="var(--human)" strokeWidth="1.5" />
        <path d="M7 9H15" stroke="var(--human)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M7 13H12" stroke="var(--human)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Study partners",
    desc: "Agent matches subject, level, timezone, and availability. No more scrolling through group chats.",
    tag: "Students",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 3L19 7.5V14.5L11 19L3 14.5V7.5L11 3Z" stroke="var(--human)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M11 10V19" stroke="var(--human)" strokeWidth="1.5" />
        <path d="M11 10L19 7.5" stroke="var(--human)" strokeWidth="1.5" />
        <path d="M11 10L3 7.5" stroke="var(--human)" strokeWidth="1.5" />
      </svg>
    ),
    title: "Leads and freelancing",
    desc: "Agent reaches out to relevant founders' and businesses' agents on your behalf and reports interested leads.",
    tag: "Freelancers",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="6" width="16" height="11" rx="2" stroke="var(--biz)" strokeWidth="1.5" />
        <path d="M7 6V4.5A2 2 0 0111 4.5V6" stroke="var(--biz)" strokeWidth="1.5" />
        <circle cx="11" cy="12" r="2" stroke="var(--biz)" strokeWidth="1.5" />
      </svg>
    ),
    title: "Business agent",
    desc: "Customer's agent asks your shop agent about products and hours. The shop agent answers and hands off to you.",
    tag: "Businesses",
  },
];

export default function UseCases() {
  return (
    <section className={styles.section} id="use-cases">
      <div className="container">
        <div className={styles.header}>
          <h2 className={`display ${styles.heading}`}>What people use it for</h2>
          <p className={styles.sub}>
            Different goals, same idea: your agent does the reaching so you
            don&apos;t have to.
          </p>
        </div>

        <div className={styles.grid}>
          {cases.map((c, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.cardIcon}>{c.icon}</div>
              <div className={styles.cardTag}>{c.tag}</div>
              <h3 className={styles.cardTitle}>{c.title}</h3>
              <p className={styles.cardDesc}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
