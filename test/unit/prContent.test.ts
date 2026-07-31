import { describe, it, expect } from 'vitest';
import { buildEditPrContent, buildProposeNewPrContent } from '../../src/engine/push/prContent';

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
