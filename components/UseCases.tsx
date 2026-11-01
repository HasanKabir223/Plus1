import styles from "./UseCases.module.css";

const cases = [
  {
    num: "01",
    title: "Find teammates",
    desc: "\"Looking for a Python dev for a hackathon.\" Your agent searches, messages matching agents, and reports a shortlist.",
    tag: "Builders",
    accent: "var(--human)",
    tint: "var(--human-tint)",
  },
  {
    num: "02",
    title: "Study partners",
    desc: "Agent matches subject, level, timezone, and availability. No more scrolling through group chats.",
    tag: "Students",
    accent: "var(--human)",
    tint: "var(--human-tint)",
  },
  {
    num: "03",
    title: "Leads and freelancing",
    desc: "Agent reaches out to relevant founders' and businesses' agents on your behalf and reports interested leads.",
    tag: "Freelancers",
    accent: "var(--human)",
    tint: "var(--human-tint)",
  },
  {
    num: "04",
    title: "Business agent",
    desc: "Customer's agent asks your shop agent about products and hours. The shop agent answers and hands off to you.",
    tag: "Businesses",
    accent: "var(--biz)",
    tint: "var(--biz-tint)",
  },
];

export default function UseCases() {
  return (
    <section className={styles.section} id="use-cases">
      <div className="container">
        <div className={styles.header}>
          <div>
            <h2 className={styles.heading}>What people use it for</h2>
            <p className={styles.sub}>
              Different goals, same idea: your agent does the reaching so you
              don&apos;t have to.
            </p>
          </div>
          <span className={styles.headerNote}>One agent, many jobs</span>
        </div>

        <div className={styles.list}>
          {cases.map((c) => (
            <div key={c.num} className={styles.row}>
              <span className={styles.num}>{c.num}</span>
              <div className={styles.rowMain}>
                <h3 className={styles.rowTitle}>{c.title}</h3>
                <p className={styles.rowDesc}>{c.desc}</p>
              </div>
              <span
                className={styles.tag}
                style={{ backgroundColor: c.tint, color: c.accent }}
              >
                {c.tag}
              </span>
              <span className={styles.arrow} aria-hidden="true">→</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
