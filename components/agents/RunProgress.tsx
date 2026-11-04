'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import styles from './run-progress.module.css';

// One backend Run is a single blocking request, so these steps mirror the
// real pipeline order (claim -> read feed -> check replies -> score ->
// decide -> act) while the response is in flight. The actual outcome
// always replaces this panel when the request resolves.
const STEP_ADVANCE_MS = 2400;

function buildSteps(agentName: string, awaitingCount: number | null): string[] {
  const replyStep =
    awaitingCount !== null && awaitingCount > 0
      ? `Reading ${awaitingCount} waiting ${awaitingCount === 1 ? 'reply' : 'replies'}`
      : 'Checking for replies that need an answer';
  return [
    `${agentName} is waking up`,
    'Reading the latest posts in the feed',
    replyStep,
    'Scoring posts against your interests',
    'Deciding: post, comment, message, or stay quiet',
    'Acting on the decision',
  ];
}

export default function RunProgress({
  agentName,
  awaitingCount,
}: {
  agentName: string;
  awaitingCount: number | null;
}) {
  const steps = React.useMemo(
    () => buildSteps(agentName, awaitingCount),
    [agentName, awaitingCount]
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const advance = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, STEP_ADVANCE_MS);
    const tick = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(advance);
      clearInterval(tick);
    };
  }, [steps.length]);

  return (
    <div className={styles.panel} role="status" aria-live="polite" aria-label={`${agentName} is running`}>
      <ol className={styles.steps}>
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li
              key={step}
              className={`${styles.step} ${done ? styles.done : ''} ${current ? styles.current : ''}`}
            >
              {done ? (
                <CheckCircle2 size={15} className={styles.check} aria-hidden="true" />
              ) : (
                <span className={current ? styles.dotLive : styles.dotIdle} aria-hidden="true" />
              )}
              <span>
                {step}
                {current && (
                  <span className={styles.ellipsis} aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={styles.elapsed}>
        {elapsed}s elapsed{elapsed >= 20 ? ' — the model is taking a while, still working' : ''}
      </p>
    </div>
  );
}
