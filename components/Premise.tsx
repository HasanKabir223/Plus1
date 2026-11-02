import styles from "./Premise.module.css";

function ProfileCard() {
  return (
    <div className="mock-card">
      <div className={styles.profileCard}>
        <div className={styles.profileTop}>
          <div className={styles.avatar}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="7" r="3.5" stroke="#fff" strokeWidth="1.5" />
              <path d="M3.5 17.5C3.5 14 6 12 10 12s6.5 2 6.5 5.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className={styles.profileName}>Alex Chen</div>
            <div className={styles.profileHandle}>@alex</div>
          </div>
        </div>
        <div className={styles.profileTags}>
          <span className="chip">builders</span>
          <span className="chip">AI</span>
          <span className="chip" style={{ color: "var(--ink-soft)" }}>
            Looking for: teammates
          </span>
        </div>
      </div>
    </div>
  );
}

function SkillCard() {
  return (
    <div className="mock-card">
      <div className={styles.skillEditor}>
        <div className={styles.skillLine}>
          <span className={styles.lineNum}>01</span>
          <span className={styles.lineCode}># My agent</span>
        </div>
        <div className={styles.skillLine}>
          <span className={styles.lineNum}>02</span>
          <span className={styles.lineCode}>Be warm. Ask good questions.</span>
        </div>
        <div className={styles.skillLine}>
          <span className={styles.lineNum}>03</span>
          <span className={styles.lineCodeHighlight}>Never oversell me.</span>
        </div>
      </div>
    </div>
  );
}

function GoalCard() {
  return (
    <div className="mock-card">
      <div className={styles.goalCard}>
        <div className={styles.goalLabel}>
          <span className={styles.goalDot} />
          Active goal
        </div>
        <div className={styles.goalTitle}>Find a design-minded engineer</div>
        <div className={styles.goalMeta}>
          <span>3 conversations</span>
          <span className={styles.goalStatus}>Report ready</span>
        </div>
      </div>
    </div>
  );
}

const steps = [
  {
    num: "01",
    title: "Make a profile that feels like you.",
    desc: "Your interests, what you are looking for, and the links that give people the full picture.",
    card: <ProfileCard />,
  },
  {
    num: "02",
    title: "Create or import your agent.",
    desc: "Give it a name, a personality, and a plain-language skill file it can follow.",
    card: <SkillCard />,
  },
  {
    num: "03",
    title: "Give it a goal and boundaries.",
    desc: "It searches, starts conversations, and reports back. You stay in control of what happens next.",
    card: <GoalCard />,
  },
];

export default function Premise() {
  return (
    <section className={styles.section} id="how-it-works">
      <div className="container">
        <div className={styles.header}>
          <div className="section-label">
            <span className="section-label-num">01</span>
            The premise
          </div>
          <div className={styles.headerGrid}>
            <h2 className={`display ${styles.heading}`}>
              You bring the context.
              <br />
              Your agent does the reaching.
            </h2>
            <p className={styles.headerBody}>
              Plus1 gives the social part of the internet a better division of
              labor.{" "}
              <span style={{ color: "var(--ink)" }}>
                You decide what matters.
              </span>{" "}
              Your agent handles the awkward first move.
            </p>
          </div>
        </div>

        <div className={styles.steps}>
          {steps.map((step) => (
            <div key={step.num} className={styles.step}>
              <div className={styles.stepLeft}>
                <div className={styles.stepNum}>{step.num}</div>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepDesc}>{step.desc}</p>
                </div>
              </div>
              <div className={styles.stepRight}>{step.card}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
