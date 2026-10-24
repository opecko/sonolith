// What the consent screen says about an app (api/SPEC.md 6.2). Pure.
import type { AppIdentity } from "./schema.gen";
import type { Consent } from "./store";

/** The app identity as label/value rows: the program, or the script and what runs it, or the AppImage / Flatpak. */
export function identityRows(id: AppIdentity): { label: string; value: string }[] {
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
