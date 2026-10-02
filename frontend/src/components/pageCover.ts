/* While a full-screen 3D view covers the whole window, the page underneath is neither styled,
 * laid out nor painted (content-visibility: hidden on every other child of <body>, see
 * realestate-hologram.css). Measured on a 4x slowed CPU while a complex loaded: the covered
 * page's layout, text shaping and paint were ~7 s of the main thread's 20 s (each web font
 * that arrived re-shaped all of its text; its nav rows and clock forced layouts), frames of
 * 0.3–1 s on the screen the reader was looking at. Its state and scroll position stay as they
 * were (the remembered size keeps the document's height). */

// (here rather than in a stylesheet: a page opened on a complex is covered before the 3D
// view's styles have loaded. The view marks its own element data-covers-page.)
const RULES = `html.re-page-covered body { background: #07090d; }
html.re-page-covered body > :not([data-covers-page]) { content-visibility: hidden; contain-intrinsic-size: auto 100vh; }`;

let covers = 0;

/** Marks the page as covered until the returned function is called (each cover counted). */
export function coverPage(): () => void {
  if (!document.getElementById("re-page-cover")) {
    const style = document.createElement("style");
    style.id = "re-page-cover";
    style.textContent = RULES;
    document.head.appendChild(style);
  }
  if (covers++ === 0) document.documentElement.classList.add("re-page-covered");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--covers === 0) document.documentElement.classList.remove("re-page-covered");
  };
}
