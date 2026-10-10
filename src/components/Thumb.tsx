import { memo } from "react";

/** Plain <img> on a placeholder background: no load-state gating (WebKitGTK can miss load events on lazy images). */
function Thumb({ src, className = "", round = false }: { src?: string; className?: string; round?: boolean }) {
  return (
    <div className={`overflow-hidden bg-[var(--c-surface-2)] ${round ? "rounded-full" : "rounded-[var(--radius)]"} ${className}`}>
      {src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
    </div>
  );
}

export default memo(Thumb);
