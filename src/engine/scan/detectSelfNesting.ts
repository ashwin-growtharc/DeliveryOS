import * as ts from 'typescript';

/**
 * First mechanical anti-pattern rule for `kind: ui-component` candidates
 * (PLAN.md's Phase 11 item 2) -- deliberately narrow, not "detect all
 * nested cards" (legitimate nesting exists: a stat card inside a
 * dashboard card is fine, and so is a genuinely recursive component
 * rendering itself once, e.g. a tree node or a nested accordion item).
 * Flags only a component whose JSX renders itself nested TWO levels
 * deep (`<A><A/></A>` -- A rendering an A that itself renders another
 * A) -- a single self-nest (just one `<A/>` somewhere in A's own
 * render, depth 1) is explicitly allowed and never flagged, since
 * that's exactly how a legitimate recursive component is normally
 * written. Two stacked levels is the real, copy-paste-shaped smell
 * this exists to catch
 * (confirmed with the user directly, since PLAN.md's own phrasing --
 * "nested directly inside itself, two or more levels deep" -- was
 * ambiguous between this and flagging any self-nest at all).
 *
 * This is the first code anywhere in this repo to import `typescript`
 * directly and walk a real AST -- `detectUiComponents.ts`/`docgen.ts`
 * only ever call `react-docgen-typescript` as a black box, which
 * returns prop docs, never a raw tree, so it can't be reused for this.
 */
export function detectSelfNestingWarnings(
  source: string,
  componentName: string,
  filePath: string,
): string[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const warnings: string[] = [];
  // Tracks how many currently-open JSX ancestors share `componentName` --
  // reset per top-level visit, incremented/decremented around exactly
  // the nodes that push/pop it below, so it always reflects the real
  // open-tag stack at any point during the walk, not a running total.
  let openSelfNestDepth = 0;

  function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
    const tagNameNode = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    return tagNameNode.getText(sourceFile);
  }

  function visit(node: ts.Node): void {
    const isMatchingJsx =
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === componentName;

    if (isMatchingJsx) {
      openSelfNestDepth++;
      // A single self-nest (one <A> inside A's own render, depth 1) is
      // explicitly allowed -- that's how a legitimate recursive
      // component is normally written. The SECOND nested <A> (depth 2:
      // <A><A>...</A></A>) is the real signal. One warning per
      // over-nested chain, not one per level past the threshold -- stop
      // descending into this specific branch so a deeper (e.g.
      // three-or-more-level) chain doesn't also report separately for
      // what's really the same single mistake.
      if (openSelfNestDepth === 2) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        warnings.push(
          `"${componentName}" renders itself nested two levels deep (line ${line + 1}) -- if this is ` +
            "deliberate recursion, this warning is safe to ignore; if it's accidental, this usually " +
            "means a copy-pasted demo/child wasn't renamed.",
        );
        openSelfNestDepth--;
        return;
      }
    }

    ts.forEachChild(node, visit);

    if (isMatchingJsx) {
      openSelfNestDepth--;
    }
  }

  visit(sourceFile);
  return warnings;
}
