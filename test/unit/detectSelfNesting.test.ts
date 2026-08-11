import { describe, expect, it } from 'vitest';
import { detectSelfNestingWarnings } from '../../src/engine/scan/detectSelfNesting';

const FILE = '/project/src/ui/Card/Card.tsx';

describe('detectSelfNestingWarnings', () => {
  it('returns [] for a component with no self-nesting at all', () => {
    const source = `
      export function Card({ children }: { children: React.ReactNode }) {
        return <div className="card">{children}</div>;
      }
    `;
    expect(detectSelfNestingWarnings(source, 'Card', FILE)).toEqual([]);
  });

  it('allows exactly one level of self-nesting -- this is how a legitimate recursive component is normally written', () => {
    const source = `
      export function Card({ children }: { children: React.ReactNode }) {
        return <div><Card>{children}</Card></div>;
      }
    `;
    expect(detectSelfNestingWarnings(source, 'Card', FILE)).toEqual([]);
  });

  it('flags two stacked levels of self-nesting, with the real line number', () => {
    const source = [
      'export function Card({ children }: { children: React.ReactNode }) {',
      '  return (',
      '    <Card>',
      '      <Card>',
      '        {children}',
      '      </Card>',
      '    </Card>',
      '  );',
      '}',
    ].join('\n');
    const warnings = detectSelfNestingWarnings(source, 'Card', FILE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Card" renders itself nested two levels deep');
    expect(warnings[0]).toContain('line 4'); // the inner <Card> -- the tag that actually crosses the threshold
  });

  it('never flags a DIFFERENT component nested inside this one -- a stat card inside a dashboard card is legitimate', () => {
    const source = `
      export function DashboardCard({ children }: { children: React.ReactNode }) {
        return <div><StatCard><StatCard>{children}</StatCard></StatCard></div>;
      }
    `;
    expect(detectSelfNestingWarnings(source, 'DashboardCard', FILE)).toEqual([]);
  });

  it('reports one warning per distinct over-nested chain, not one per level past the threshold (a 4-level chain is still one mistake)', () => {
    const source = [
      'export function Card() {',
      '  return <Card><Card><Card><Card /></Card></Card></Card>;',
      '}',
    ].join('\n');
    expect(detectSelfNestingWarnings(source, 'Card', FILE)).toHaveLength(1);
  });

  it('reports two separate warnings for two separate two-level chains in the same file', () => {
    const source = [
      'export function Card() {',
      '  return null;',
      '}',
      'export function OtherThing() {',
      '  return (',
      '    <div>',
      '      <Card><Card><Card /></Card></Card>',
      '      <Card><Card><Card /></Card></Card>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    expect(detectSelfNestingWarnings(source, 'Card', FILE)).toHaveLength(2);
  });

  it('detects self-closing elements the same way as open/close pairs', () => {
    const source = [
      'export function Card() {',
      '  return <Card><Card><Card /></Card></Card>;',
      '}',
    ].join('\n');
    expect(detectSelfNestingWarnings(source, 'Card', FILE)).toHaveLength(1);
  });
});
