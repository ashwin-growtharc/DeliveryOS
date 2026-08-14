import { describe, expect, it } from 'vitest';
import { parseRoutesTree } from '../../src/engine/routes/parseRoutesTree';

const FILE = '/project/src/routes.tsx';

const REAL_STARTER_KIT_ROUTES = `
  import { createBrowserRouter, Navigate } from 'react-router';
  import Layout from './layout/Layout';
  import RootErrorBoundary from './RootErrorBoundary';
  import ProtectedRoute from './lib/auth/ProtectedRoute';
  import AdminRoute from './lib/auth/AdminRoute';
  import Unauthorized from './lib/auth/Unauthorized';
  import Page1 from './pages/Page1';
  import Page2 from './pages/Page2';
  import Page3 from './pages/Page3';
  import Page4 from './pages/Page4';
  import Admin from './pages/Admin';

  export const router = createBrowserRouter([
    {
      path: '/',
      element: <ProtectedRoute />,
      errorElement: <RootErrorBoundary />,
      children: [
        {
          path: '',
          element: <Layout />,
          children: [
            { index: true, element: <Navigate to="page-1" replace /> },
            { path: 'page-1', element: <Page1 /> },
            { path: 'page-2', element: <Page2 /> },
            { path: 'page-3', element: <Page3 /> },
            { path: 'page-4', element: <Page4 /> },
            {
              path: 'admin',
              element: <AdminRoute />,
              children: [{ index: true, element: <Admin /> }],
            },
            { path: '*', element: <Navigate to="/" replace /> },
          ],
        },
      ],
    },
    { path: '/unauthorized', element: <Unauthorized /> },
  ]);
`;

describe('parseRoutesTree', () => {
  it('parses the real growtharc-react-vite-starter routes.tsx shape end to end', () => {
    const routes = parseRoutesTree(REAL_STARTER_KIT_ROUTES, FILE);

    expect(routes).toHaveLength(2);

    const [root, unauthorized] = routes;

    expect(root.path).toBe('/');
    expect(root.element).toBe('ProtectedRoute');
    expect(root.errorElement).toBe('RootErrorBoundary');
    expect(root.children).toHaveLength(1);

    const layoutRoute = root.children![0];
    expect(layoutRoute.path).toBe('');
    expect(layoutRoute.element).toBe('Layout');
    expect(layoutRoute.children).toHaveLength(7);

    const [indexRoute, page1, page2, page3, page4, adminRoute, catchAll] = layoutRoute.children!;

    expect(indexRoute.path).toBe('(index)');
    expect(indexRoute.element).toBe('Navigate');

    expect(page1.path).toBe('page-1');
    expect(page1.element).toBe('Page1');
    expect(page2.path).toBe('page-2');
    expect(page3.path).toBe('page-3');
    expect(page4.path).toBe('page-4');

    expect(adminRoute.path).toBe('admin');
    expect(adminRoute.element).toBe('AdminRoute');
    expect(adminRoute.children).toHaveLength(1);
    expect(adminRoute.children![0].path).toBe('(index)');
    expect(adminRoute.children![0].element).toBe('Admin');

    expect(catchAll.path).toBe('*');
    expect(catchAll.element).toBe('Navigate');

    expect(unauthorized.path).toBe('/unauthorized');
    expect(unauthorized.element).toBe('Unauthorized');
    expect(unauthorized.children).toBeUndefined();
  });

  it('returns [] when there is no createBrowserRouter call at all', () => {
    const source = `
      export function App() {
        return <div>hello</div>;
      }
    `;
    expect(parseRoutesTree(source, FILE)).toEqual([]);
  });

  it('returns [] when createBrowserRouter is called with something other than an array literal', () => {
    const source = `
      const routeConfig = getRoutesFromSomewhereElse();
      export const router = createBrowserRouter(routeConfig);
    `;
    expect(parseRoutesTree(source, FILE)).toEqual([]);
  });

  it('returns [] on unparseable/malformed input rather than throwing', () => {
    const source = 'export const router = createBrowserRouter([{ path: ';
    expect(() => parseRoutesTree(source, FILE)).not.toThrow();
    expect(parseRoutesTree(source, FILE)).toEqual([]);
  });

  it('skips array elements that are not object literals', () => {
    const source = `
      export const router = createBrowserRouter([
        null,
        { path: '/only-real-one', element: <Home /> },
      ]);
    `;
    const routes = parseRoutesTree(source, FILE);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/only-real-one');
  });
});
