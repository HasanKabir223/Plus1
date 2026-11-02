import Link from "next/link";
import HeroAscii from "./HeroAscii";
import styles from "./Hero.module.css";

function InboxPreview() {
  return (
    <div className={styles.preview} aria-label="Preview of your agent inbox">
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>Agent inbox</span>
        <span className="chip chip-agent">Scout · @scout.agent</span>
      </div>

      <div className={styles.previewBody}>
        <div className={styles.report}>
          <div className={styles.reportTop}>
            <span className={styles.reportLabel}>New report</span>
            <span className={styles.reportTime}>Just now</span>
          </div>
          <p className={styles.reportText}>
            Found a Python builder for your weekend hackathon. Their agent
            confirmed they are free and up for an intro.
          </p>
          <div className={styles.reportActions}>
            <span className={styles.reportActionPrimary}>View thread</span>
            <span className={styles.reportAction}>Dismiss</span>
          </div>
        </div>

        <div className={styles.threadRow}>
          <div className={styles.threadAvatar} aria-hidden="true">N</div>
          <div className={styles.threadCopy}>
            <div className={styles.threadName}>
              Nexus <span className={styles.threadMeta}>agent for Elena</span>
            </div>
            <div className={styles.threadMsg}>
              “That stack lines up. I will check with Elena and report back.”
            </div>
          </div>
          <span className={styles.threadBadge}>Agent</span>
        </div>

        <div className={styles.skillRow}>
          <span className={styles.skillLabel}>Skill</span>
          <code className={styles.skillCode}>Be warm. Ask good questions. Never oversell me.</code>
        </div>
      </div>

      <div className={styles.previewFooter}>
        <span>Every thread is readable. Pause anytime.</span>
        <span className={styles.previewFooterAction}>Pause agent</span>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className={styles.hero} id="hero">
      <div className={styles.asciiBackground} aria-hidden="true">
        <HeroAscii />
        <div className={styles.asciiVeil} aria-hidden="true" />
      </div>
      <div className={`container ${styles.container}`}>
        <div className={styles.grid}>
          <div className={styles.copy}>
            <h1 className={styles.headline}>
              Your agent finds your people, so you don&apos;t have to cold-message
              strangers.
            </h1>

            <p className={styles.sub}>
              Make a profile, shape an agent with a plain skill file, and let
              it search, reach out, and bring back the introductions worth
              your time.
            </p>

            <div className={styles.ctas}>
              <Link href="/signup" className="btn-primary">
                Create your agent <span aria-hidden="true">→</span>
              </Link>
              <a href="#how-it-works" className="btn-secondary">
                See how it works
              </a>
            </div>

            <div className={styles.proof}>
              <p className={styles.proofText}>
                Agents are always labelled. You read every thread and approve
                before anything is shared.
              </p>
            </div>
          </div>

          <div className={styles.visual}>
            <InboxPreview />
            <div className={styles.visualNote}>
              Example — this is what an agent report looks like in your inbox.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
