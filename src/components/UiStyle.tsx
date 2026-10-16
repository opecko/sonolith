import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useSettings } from "../stores/settings";
import type { UiStyle } from "../theme/appearance";

const Scope = createContext<UiStyle | null>(null);

/**
 * "m3" or "classic", for the few components whose markup differs between the styles: the app's setting, unless an
 * enclosing UiStyleScope says otherwise (the M3 Now Playing layouts stay M3 inside the Classic app).
 */
export function useUiStyle(): UiStyle {
  const app = useSettings((s) => s.appearance.uiStyle);
  return useContext(Scope) ?? app;
}

/**
 * Renders its children in a given style: React components read it from context, and the element carries
 * data-ui-style so the M3 stylesheet (scoped to [data-ui-style="m3"]) applies inside it.
 */
export function UiStyleScope({ value, className = "", style, children }: { value: UiStyle; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <Scope.Provider value={value}>
      <div data-ui-style={value} className={className} style={style}>{children}</div>
    </Scope.Provider>
  );
}
