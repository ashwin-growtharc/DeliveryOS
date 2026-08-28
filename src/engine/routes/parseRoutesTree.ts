import * as ts from 'typescript';

/**
 * The second piece of code in this repo (after detectSelfNesting.ts) to
 * import `typescript` directly and walk a real AST. Best-effort and
 * non-throwing: a routes.tsx shaped differently than expected just
 * yields [], never an error.
 */

export interface RouteNode {
  path: string;
  element?: string;
  errorElement?: string;
  children?: RouteNode[];
}

export function parseRoutesTree(source: string, filePath = 'routes.tsx'): RouteNode[] {
  try {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const routerCall = findCreateBrowserRouterCall(sourceFile);
    if (!routerCall) return [];

    const [routesArg] = routerCall.arguments;
    if (!routesArg || !ts.isArrayLiteralExpression(routesArg)) return [];

    return parseRouteArray(routesArg, sourceFile);
  } catch {
    return [];
  }
}

function findCreateBrowserRouterCall(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;

  function visit(node: ts.Node): void {
    if (found) return;

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createBrowserRouter') {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function parseRouteArray(arrayLiteral: ts.ArrayLiteralExpression, sourceFile: ts.SourceFile): RouteNode[] {
  const routes: RouteNode[] = [];

  for (const element of arrayLiteral.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const route = parseRouteObject(element, sourceFile);
    if (route) routes.push(route);
  }

  return routes;
}

function parseRouteObject(obj: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): RouteNode | undefined {
  let path: string | undefined;
  let isIndex = false;
  let element: string | undefined;
  let errorElement: string | undefined;
  let children: RouteNode[] | undefined;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

    const key = prop.name.text;
    const value = prop.initializer;

    if (key === 'path' && ts.isStringLiteralLike(value)) {
      path = value.text;
    } else if (key === 'index' && value.kind === ts.SyntaxKind.TrueKeyword) {
      isIndex = true;
    } else if (key === 'element' && isJsxNode(value)) {
      element = jsxTagName(value, sourceFile);
    } else if (key === 'errorElement' && isJsxNode(value)) {
      errorElement = jsxTagName(value, sourceFile);
    } else if (key === 'children' && ts.isArrayLiteralExpression(value)) {
      children = parseRouteArray(value, sourceFile);
    }
  }

  if (path === undefined && !isIndex) return undefined;

  const node: RouteNode = { path: isIndex ? '(index)' : (path as string) };
  if (element) node.element = element;
  if (errorElement) node.errorElement = errorElement;
  if (children && children.length > 0) node.children = children;

  return node;
}

function isJsxNode(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

function jsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement, sourceFile: ts.SourceFile): string {
  const tagNameNode = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return tagNameNode.getText(sourceFile);
}
