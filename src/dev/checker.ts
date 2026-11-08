// Dev toolkit: a checkerboard painted on <html>, under the (translucent) body, to see how much of the window is
// transparent without a busy desktop behind it. A <style> element, so a release build has no trace of it.
const ID = "dev-checkerboard";

export const checkerOn = () => !!document.getElementById(ID);

export function setChecker(on: boolean) {
  document.getElementById(ID)?.remove();
  if (!on) return;
  const style = document.createElement("style");
  style.id = ID;
  style.textContent = `html { background: repeating-conic-gradient(color-mix(in srgb, var(--c-text) 30%, transparent) 0% 25%, transparent 0% 50%) 0 0 / 24px 24px; }`;
  document.head.append(style);
}
