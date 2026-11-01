export default function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}
      role="status"
      aria-label="Loading"
    >
      <style>{`@keyframes plus1-pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
      <div
        style={{
          height: 28,
          width: "42%",
          borderRadius: 6,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          animation: "plus1-pulse 1.2s ease-in-out infinite",
          marginBottom: 20,
        }}
      />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            padding: "16px 0",
            borderTop: "1px solid var(--line)",
            animation: "plus1-pulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 90}ms`,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: i % 2 ? "50%" : 9,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                height: 14,
                width: "34%",
                borderRadius: 4,
                background: "var(--surface)",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                height: 12,
                width: "78%",
                borderRadius: 4,
                background: "var(--surface)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
