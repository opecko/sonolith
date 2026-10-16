import { Spinner } from "./LoadingIndicator";
import { useEffect, useRef } from "react";

export default function LoadMore({ onVisible, active, loading }: { onVisible: () => void; active: boolean; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && onVisible(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active, onVisible]);
  return (
    <div ref={ref} className="flex h-16 items-center justify-center text-[var(--c-text-subtle)]" aria-live="polite">
      {loading && <Spinner size={24} label="Loading more" />}
    </div>
  );
}
