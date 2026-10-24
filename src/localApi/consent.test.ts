import { describe, expect, it } from "vitest";
import { consentTitle, identityRows } from "./consent";
import type { AppIdentity } from "./schema.gen";

const base: AppIdentity = { kind: "executable", key: "exe:/usr/bin/mybar", executable: "/usr/bin/mybar", interpreter: null, script: null, appImage: null, flatpakId: null };

describe("identityRows", () => {
  it("names the program, the script and its interpreter, the AppImage or the Flatpak", () => {
    expect(identityRows(base)).toEqual([{ label: "Program", value: "/usr/bin/mybar" }]);
    const script = { ...base, kind: "interpreter" as const, key: "interp:python3:/home/u/bar.py", executable: "/usr/bin/python3.13", interpreter: "/usr/bin/python3.13", script: "/home/u/bar.py" };
    expect(identityRows(script)).toEqual([{ label: "Script", value: "/home/u/bar.py" }, { label: "Run by", value: "/usr/bin/python3.13" }]);
    expect(identityRows({ ...script, key: "interp:python3:module:mybar", script: null })[0].value).toBe("Module mybar");
    expect(identityRows({ ...script, key: "interp:node:-", script: null })[0].value).toBe("Inline code or an interactive session");
    expect(identityRows({ ...base, kind: "flatpak", flatpakId: "com.example.Bar" })).toEqual([{ label: "Flatpak app", value: "com.example.Bar" }]);
  });

  it("shows invisible and direction characters in paths instead of obeying them", () => {
    // "/home/u/\u202Ehs.lab" would render as "/home/u/bal.sh".
    const id = { ...base, executable: "/home/u/\u202Ehs.lab", key: "exe:x" };
    expect(identityRows(id)[0].value).toBe("/home/u/<U+202E>hs.lab");
    const script = { ...base, kind: "interpreter" as const, key: "interp:bash:x", interpreter: "bash", script: "/tmp/a\nb\u200B.sh" };
    expect(identityRows(script)[0].value).toBe("/tmp/a<U+000A>b<U+200B>.sh");
  });

  it("titles each kind of request", () => {
    expect(consentTitle({ kind: "register", name: "Bar" })).toBe("Bar wants to connect to Sonolith");
    expect(consentTitle({ kind: "identity", name: "Bar" })).toBe("Bar was updated or moved");
  });
});
