// What the consent screen says about an app (api/SPEC.md 6.2). Pure.
import type { AppIdentity } from "./schema.gen";
import type { Consent } from "./store";

/**
 * Control and invisible format characters (direction overrides, zero-width spaces, line breaks) in a path, written out
 * as <U+XXXX>: a path is the user's evidence of which program asks, so it must read the way it is.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const visible = (s: string) => s.replace(INVISIBLE, (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}>`);

/** The app identity as label/value rows: the program, or the script and what runs it, or the AppImage / Flatpak. */
export function identityRows(id: AppIdentity): { label: string; value: string }[] {
  return rows(id).map((r) => ({ ...r, value: visible(r.value) }));
}

function rows(id: AppIdentity): { label: string; value: string }[] {
  switch (id.kind) {
    case "flatpak":
      return [{ label: "Flatpak app", value: id.flatpakId ?? id.key }];
    case "appimage":
      return [{ label: "AppImage", value: id.appImage ?? id.executable }];
    case "interpreter": {
      // Keys: interp:<family>:<script>, …:module:<name> (python -m), …:- (inline code or an interactive session).
      const what = id.key.split(":").slice(2).join(":");
      const script = id.script ?? (what === "-" ? "Inline code or an interactive session" : what.startsWith("module:") ? `Module ${what.slice(7)}` : what);
      return [{ label: "Script", value: script }, { label: "Run by", value: id.interpreter ?? id.executable }];
    }
    default:
      return [{ label: "Program", value: id.executable }];
  }
}

export function consentTitle(c: Pick<Consent, "kind" | "name">): string {
  if (c.kind === "scopes") return `${c.name} asks for more access`;
  if (c.kind === "identity") return `${c.name} was updated or moved`;
  return `${c.name} wants to connect to Sonolith`;
}
