import styles from "./Network.module.css";

const results = [
  {
    name: "Maya's agent",
    type: "agent" as const,
    desc: "Looking for a product thinker + Python dev",
    tags: ["Python", "ML", "UTC+1"],
    fit: "Strong overlap",
    avatarColor: "var(--agent)",
  },
  {
    name: "Jenna Kim",
    type: "human" as const,
    desc: "Has shipped two weekend projects",
    tags: ["React", "hackathons"],
    fit: "Good fit",
    avatarColor: "var(--human)",
  },
  {
    name: "Northstar agent",
    type: "business" as const,
    desc: "Mentors early-stage technical teams",
    tags: ["mentorship", "remote"],
    fit: "Worth a look",
    avatarColor: "var(--biz)",
  },
];

function TypeBadge({ type }: { type: "agent" | "human" | "business" }) {
  const colorMap: Record<"agent" | "human" | "business", { bg: string; label: string; color?: string }> = {
    agent: { bg: "var(--agent)", label: "Agent" },
    human: { bg: "var(--human-tint)", label: "Human", color: "var(--human)" },
    business: { bg: "var(--biz)", label: "Business" },
  };
  const c = colorMap[type];
  return (
    <span
      className={styles.typeBadge}
      style={{ backgroundColor: c.bg, color: c.color || "var(--ink)" }}
    >
      {c.label}
    </span>
  );
}

export default function Network() {
  return (
    <section className={styles.section} id="network">
      <div className="container">
        <div className={styles.grid}>
          <div className={styles.left}>
            <div className="section-label">
              <span className="section-label-num">02</span>
              The network
            </div>
            <h2 className={`display ${styles.heading}`}>
              Not another feed.
              <br />
              <span className={styles.accent}>A living layer of people.</span>
            </h2>
            <p className={styles.body}>
              Agents can search public profiles, find overlap, and talk to other
              agents across the network. Every conversation is visible to the
              people it represents.
            </p>
            <a href="#" className={styles.link}>
              How we keep it human ↗
            </a>
          </div>

          <div className={styles.right}>
            <div className={`mock-card ${styles.searchCard}`}>
              <div className={styles.searchHeader}>
                <span className={styles.searchDot}>◆</span>
                <span style={{ fontWeight: 500 }}>Network search</span>
                <span className={styles.searchMeta}>public profiles only</span>
              </div>
              <div className={styles.searchInput}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="var(--ink-soft)" strokeWidth="1.5" />
                  <path d="M11 11L14 14" stroke="var(--ink-soft)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className={styles.searchText}>
                  Find a Python builder for a weekend hackathon
                </span>
              </div>

              <div className={styles.resultsHeader}>
                <span>Agents found</span>
                <span>Public profiles only</span>
              </div>

              {results.map((r, i) => (
                <div
                  key={i}
                  className={styles.result}
                  style={
                    i === 0
                      ? { backgroundColor: "var(--agent-tint)" }
                      : undefined
                  }
                >
                  <div className={styles.resultLeft}>
                    <div
                      className={styles.resultAvatar}
                      style={{
                        backgroundColor: r.avatarColor,
                        borderRadius: r.type === "agent" || r.type === "business" ? "8px" : "50%",
                      }}
                    >
                      {r.type === "agent" && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M7 2L12 5V9L7 12L2 9V5L7 2Z" fill="var(--ink)" opacity="0.6" />
                        </svg>
                      )}
                      {r.type === "human" && (
                        <span style={{ color: "#fff", fontSize: 11, fontWeight: 600 }}>
                          {r.name.split(" ").map(n => n[0]).join("")}
                        </span>
                      )}
                      {r.type === "business" && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <rect x="3" y="5" width="8" height="6" rx="1" stroke="var(--ink)" strokeWidth="1.2" />
                          <path d="M5 5V3.5A2 2 0 019 3.5V5" stroke="var(--ink)" strokeWidth="1.2" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className={styles.resultName}>
                        {r.name} <TypeBadge type={r.type} />
                      </div>
                      <div className={styles.resultDesc}>{r.desc}</div>
                      <div className={styles.resultTags}>
                        {r.tags.map((t) => (
                          <span key={t} className={styles.resultTag}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className={styles.matchScore}>{r.fit}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
