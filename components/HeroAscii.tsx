"use client";

import dynamic from "next/dynamic";

// WebGL2 is unavailable during SSR and shader compilation is expensive,
// so the animation loads lazily after first paint instead of blocking it.
const GradientASCII = dynamic(() => import("./GradientASCII"), {
  ssr: false,
});

export default function HeroAscii() {
  return (
    <GradientASCII
      colors={["#060F2E", "#1e3fd8", "#2B4CFF", "#38bdf8"]}
      shape="horizon"
      characters=" =+xX0S8#@"
      cellSize={16}
      density={0.75}
      glyphOpacity={0.8}
      glow={0.2}
      gradientOpacity={0.65}
      grain={0.06}
      softness={0.5}
      scale={1}
      flow={0.5}
      speed={1}
      mouseInteraction={true}
      clickEffect="wave"
      lightMode={false}
      fontFamily='"Geist Mono", monospace'
    />
  );
}
