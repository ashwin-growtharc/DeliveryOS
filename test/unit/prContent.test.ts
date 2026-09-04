import { describe, it, expect } from 'vitest';
import { buildEditPrContent, buildProposeNewPrContent } from '../../src/engine/push/prContent';

describe('buildEditPrContent -- who opened it', () => {
  const base = {
    id: 'risk-register',
    kind: 'doc',
    owner: 'test-team',
    version: '1.0.1',
    previousVersion: '1.0.0',
    gitUserName: 'Ashwin B',
    gitUserEmail: 'ashwin@example.com',
    changedFiles: [{ relPath: 'README.md', status: 'modified' as const }],
  };

  it('says so when an agent opened it, above everything else in the body', () => {
    // The precedent is the forced-stale block: it exists because "the PR
    // reviewer is the only remaining safeguard and has to be told explicitly".
    // A reviewer deciding how carefully to read a diff is entitled to know a
    // model assembled it -- `**Pushed by:**` is a git identity and says only
    // who the commit is attributed to, not what drove the push.
    const content = buildEditPrContent({ ...base, initiatedBy: 'the DeliveryOS MCP server' });

    expect(content.body).toContain('[!NOTE]');
    expect(content.body).toContain('the DeliveryOS MCP server');
    expect(content.body).toContain('assembled');

    // Above the metadata line, so it is not lost below a long diff.
    expect(content.body.indexOf('[!NOTE]')).toBeLessThan(content.body.indexOf('**Kind:**'));
  });

  it('renders byte-identically to before when absent', () => {
    // Every existing caller -- CLI, sidecar, app -- passes nothing, and their
    // PR bodies must not change at all.
    const withField = buildEditPrContent({ ...base, initiatedBy: undefined });
    const without = buildEditPrContent({ ...base });
    expect(withField.body).toBe(without.body);
    expect(without.body).not.toContain('[!NOTE]');
  });
});

describe('buildEditPrContent', () => {
  it('includes id, kind, owner, version, and one line per changed file', () => {
    const content = buildEditPrContent({
      id: 'welcome-template',
      kind: 'template',
      owner: 'test-team',
      version: '1.2.3',
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      changedFiles: [
        { relPath: 'README.md', status: 'modified' },
        { relPath: 'new.txt', status: 'added' },
        { relPath: 'old.txt', status: 'deleted' },
      ],
    });

    expect(content.title).toContain('welcome-template');
    expect(content.title).toContain('1.2.3');

    expect(content.body).toContain('welcome-template');
    expect(content.body).toContain('template');
    expect(content.body).toContain('test-team');
    expect(content.body).toContain('1.2.3');
    expect(content.body).toContain('Ashwin B');
    expect(content.body).toContain('ashwin@example.com');
    expect(content.body).toContain('modified: payload/README.md');
    expect(content.body).toContain('added: payload/new.txt');
    expect(content.body).toContain('deleted: payload/old.txt');
  });

  it('shows a version arrow when previousVersion differs from version (Phase E)', () => {
    const content = buildEditPrContent({
      id: 'welcome-template',
      kind: 'template',
      owner: 'test-team',
      version: '1.0.1',
      previousVersion: '1.0.0',
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      changedFiles: [{ relPath: 'README.md', status: 'modified' }],
    });

    expect(content.title).toContain('v1.0.0 -> v1.0.1');
    expect(content.body).toContain('v1.0.0 -> v1.0.1');
  });

  it('embeds the preview image as a markdown image tag when previewImageUrl is set (Phase E)', () => {
    const content = buildEditPrContent({
      id: 'welcome-template',
      kind: 'ui-component',
      owner: 'test-team',
      version: '1.0.1',
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      changedFiles: [{ relPath: 'Button.tsx', status: 'modified' }],
      previewImageUrl: 'https://raw.githubusercontent.com/acme/repo/deliveryos/welcome-template/123/artifacts/welcome-template/payload/preview.png',
    });

    expect(content.body).toContain(
      '![preview](https://raw.githubusercontent.com/acme/repo/deliveryos/welcome-template/123/artifacts/welcome-template/payload/preview.png)',
    );
  });

  it('omits the Preview section entirely when no preview image was generated', () => {
    const content = buildEditPrContent({
      id: 'welcome-template',
      kind: 'template',
      owner: 'test-team',
      version: '1.0.1',
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      changedFiles: [{ relPath: 'README.md', status: 'modified' }],
    });

    expect(content.body).not.toContain('### Preview');
  });

  it('falls back to a Files-changed pointer, never a broken link, when a preview exists but is not embeddable (private repo)', () => {
    // Regression guard for a real bug: raw.githubusercontent.com does not
    // serve private-repo content to an unauthenticated request, and
    // GitHub's PR-body renderer separately strips `data:` URI images
    // entirely -- both confirmed by hand. previewImageGitPath (always set
    // when a preview was generated) without previewImageUrl (only set when
    // embeddable) must produce a real, working fallback, never a dead
    // `![]()` tag.
    const content = buildEditPrContent({
      id: 'welcome-template',
      kind: 'ui-component',
      owner: 'test-team',
      version: '1.0.1',
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      changedFiles: [{ relPath: 'Button.tsx', status: 'modified' }],
      previewImageGitPath: 'artifacts/welcome-template/payload/preview.png',
    });

    expect(content.body).toContain('### Preview');
    expect(content.body).not.toContain('![preview]');
    expect(content.body).not.toContain('raw.githubusercontent.com');
    expect(content.body).toContain('artifacts/welcome-template/payload/preview.png');
    expect(content.body).toContain('Files changed');
  });
});

describe('buildProposeNewPrContent', () => {
  it('includes id, kind, owner, version, tags, and one line per new file', () => {
    const content = buildProposeNewPrContent({
      id: 'brand-new-artifact',
      kind: 'config',
      owner: 'platform-team',
      version: '1.0.0',
      installTarget: 'brand-new-artifact',
      tags: { roles: ['eng'], teams: ['platform'], stacks: ['node'], componentTypes: [] },
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      payloadFiles: ['README.md', 'config.yaml'],
    });

    expect(content.title).toContain('brand-new-artifact');

    expect(content.body).toContain('brand-new-artifact');
    expect(content.body).toContain('config');
    expect(content.body).toContain('platform-team');
    expect(content.body).toContain('1.0.0');
    expect(content.body).toContain('brand-new-artifact');
    expect(content.body).toContain('eng');
    expect(content.body).toContain('platform');
    expect(content.body).toContain('node');
    expect(content.body).toContain('artifacts/brand-new-artifact/manifest.yaml');
    expect(content.body).toContain('artifacts/brand-new-artifact/payload/README.md');
    expect(content.body).toContain('artifacts/brand-new-artifact/payload/config.yaml');
  });

  it('embeds the preview image as a markdown image tag when previewImageUrl is set (Phase E)', () => {
    const content = buildProposeNewPrContent({
      id: 'brand-new-artifact',
      kind: 'ui-component',
      owner: 'platform-team',
      version: '1.0.0',
      installTarget: 'brand-new-artifact',
      tags: { roles: [], teams: [], stacks: [], componentTypes: ['button'] },
      gitUserName: 'Ashwin B',
      gitUserEmail: 'ashwin@example.com',
      payloadFiles: ['Button.tsx', 'preview.tsx'],
      previewImageUrl: 'https://raw.githubusercontent.com/acme/repo/deliveryos/brand-new-artifact/123/artifacts/brand-new-artifact/payload/preview.png',
    });

    expect(content.body).toContain(
      '![preview](https://raw.githubusercontent.com/acme/repo/deliveryos/brand-new-artifact/123/artifacts/brand-new-artifact/payload/preview.png)',
    );
  });
});
