/**
 * Applies CSS under the production CSP (`style-src 'self'`, no unsafe-inline). A `<style>` element with text content is
 * blocked there, but a constructed stylesheet set through the CSS object model is allowed. Returns the remover.
 */
export function adoptCss(doc: Document, css: string): () => void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  return () => { doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet); };
}
