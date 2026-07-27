import { describe, it, expect } from 'vitest';
import { toPushOptions } from '../../src/cli/commands/push';

describe('toPushOptions', () => {
  it('lowercases and trims --roles/--teams/--stacks so mixed-case tags land under one canonical value', () => {
    const options = toPushOptions({
      new: true,
      roles: ' PM, Engagement-Lead ',
      teams: 'Platform,ENGAGEMENT',
      stacks: 'Python, TypeScript ,  java',
    });

    expect(options.roles).toEqual(['pm', 'engagement-lead']);
    expect(options.teams).toEqual(['platform', 'engagement']);
    expect(options.stacks).toEqual(['python', 'typescript', 'java']);
  });

  it('drops empty entries produced by trailing/double commas', () => {
    const options = toPushOptions({ new: true, stacks: 'python,,  ,typescript,' });
    expect(options.stacks).toEqual(['python', 'typescript']);
  });

  it('leaves roles/teams/stacks undefined when the flag was never passed', () => {
    const options = toPushOptions({});
    expect(options.roles).toBeUndefined();
    expect(options.teams).toBeUndefined();
    expect(options.stacks).toBeUndefined();
  });

  it('maps every other --new flag onto PushOptions unchanged, defaulting booleans to false', () => {
    const options = toPushOptions({
      new: true,
      remote: 'arcos-poc',
      path: '/tmp/payload',
      kind: 'template',
      owner: 'platform-team',
      description: 'A test artifact',
      installTarget: 'custom/target',
      artifactVersion: '2.1.0',
      reviewRequired: true,
      postInstall: 'npm install',
    });

    expect(options).toMatchObject({
      remote: 'arcos-poc',
      isNew: true,
      payloadPath: '/tmp/payload',
      kind: 'template',
      owner: 'platform-team',
      description: 'A test artifact',
      installTarget: 'custom/target',
      version: '2.1.0',
      reviewRequired: true,
      postInstall: 'npm install',
    });
    expect(options.metadataEdit).toBeUndefined();
  });

  it('without --new, --description/--roles/--teams/--stacks route into metadataEdit instead of the top-level new-manifest fields', () => {
    const options = toPushOptions({
      description: 'Updated description',
      roles: 'PM, Engineering',
      teams: 'Platform',
      stacks: 'Python',
    });

    expect(options.isNew).toBe(false);
    expect(options.description).toBeUndefined();
    expect(options.roles).toBeUndefined();
    expect(options.teams).toBeUndefined();
    expect(options.stacks).toBeUndefined();
    expect(options.metadataEdit).toEqual({
      description: 'Updated description',
      roles: ['pm', 'engineering'],
      teams: ['platform'],
      stacks: ['python'],
    });
  });

  it('leaves metadataEdit undefined without --new when none of description/roles/teams/stacks were passed', () => {
    const options = toPushOptions({ remote: 'arcos-poc' });
    expect(options.metadataEdit).toBeUndefined();
  });
});
