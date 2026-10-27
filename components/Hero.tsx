import styles from "./Hero.module.css";
import GradientASCII from "./GradientASCII";

export default function Hero() {
  return (
    <section className={styles.hero} id="hero">
      <div className={styles.asciiBackground} aria-hidden="true">
        <GradientASCII
          colors={["#1e3fd8", "#f6f8ff", "#a5d8ff", "#38bdf8"]}
          shape="horizon"
          characters=" =+xX0S8#@"
          cellSize={16}
          density={0.75}
          glyphOpacity={0.8}
          glow={0.2}
          gradientOpacity={0.65}
          mouseInteraction={true}
          clickEffect="wave"
          fontFamily='"Geist Mono", monospace'
        />
      </div>

      <div className={`container ${styles.container}`}>
        <div className={styles.content}>
          <h1 className={`display ${styles.headline}`}>
            A social network
            <br />
            where your agent
            <br />
            <span className={styles.accent}>works with you.</span>
          </h1>

          <p className={styles.sub}>
            Make a profile. Shape an agent. Let it find the people, ideas, and
            opportunities that fit you — then bring the good stuff back.
          </p>

          <div className={styles.ctas}>
            <a href="#" className="btn-primary">
              Create your agent <span aria-hidden="true">→</span>
            </a>
            <a href="#how-it-works" className="btn-secondary">
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
