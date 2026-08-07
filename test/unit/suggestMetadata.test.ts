import { describe, it, expect } from 'vitest';
import { buildSuggestionPrompt, parseSuggestionResponse } from '../../src/engine/scan/suggestMetadata';
import { SuggestionError } from '../../src/engine/errors';

describe('buildSuggestionPrompt (Suggest with Claude)', () => {
  it('embeds the real source and the kind, and asks for strict JSON', () => {
    const prompt = buildSuggestionPrompt('export function Widget() {}', 'ui-component');
    expect(prompt).toContain('export function Widget() {}');
    expect(prompt).toContain('"ui-component"');
    expect(prompt).toContain('STRICT JSON');
    expect(prompt).toContain('description');
    expect(prompt).toContain('componentTypes');
  });

  it('instructs the model not to guess when it genuinely cannot tell', () => {
    const prompt = buildSuggestionPrompt('const x = 1;', 'backend-plugin');
    expect(prompt.toLowerCase()).toContain('rather');
    expect(prompt.toLowerCase()).toContain('guessing');
  });
});

describe('parseSuggestionResponse (Suggest with Claude)', () => {
  function envelope(result: string, isError = false): string {
    return JSON.stringify({ type: 'result', is_error: isError, result });
  }

  it('parses a real, well-formed claude JSON envelope', () => {
    const raw = envelope('{"description": "A themed button.", "componentTypes": ["button"]}');
    expect(parseSuggestionResponse(raw)).toEqual({
      description: 'A themed button.',
      componentTypes: ['button'],
    });
  });

  it('strips a ```json fence the model wrapped its answer in, despite being told not to', () => {
    const raw = envelope('```json\n{"description": "A form.", "componentTypes": ["form"]}\n```');
    expect(parseSuggestionResponse(raw)).toEqual({
      description: 'A form.',
      componentTypes: ['form'],
    });
  });

  it('treats an empty description/componentTypes as a valid, honest "no suggestion" result', () => {
    const raw = envelope('{"description": "", "componentTypes": []}');
    expect(parseSuggestionResponse(raw)).toEqual({ description: undefined, componentTypes: [] });
  });

  it('filters out non-string entries in componentTypes rather than throwing', () => {
    const raw = envelope('{"description": "ok", "componentTypes": ["button", 5, null, "form"]}');
    expect(parseSuggestionResponse(raw).componentTypes).toEqual(['button', 'form']);
  });

  it('throws SuggestionError when claude itself reports is_error', () => {
    const raw = envelope('Not logged in · Please run /login', true);
    expect(() => parseSuggestionResponse(raw)).toThrow(SuggestionError);
  });

  it('throws SuggestionError when the outer envelope is not valid JSON at all', () => {
    expect(() => parseSuggestionResponse('not json')).toThrow(SuggestionError);
  });

  it('throws SuggestionError when the inner result text is not valid JSON', () => {
    const raw = envelope('Sure, here is a button component.');
    expect(() => parseSuggestionResponse(raw)).toThrow(SuggestionError);
  });

  it('returns an empty object, not a throw, when the inner JSON parses but is not an object', () => {
    const raw = envelope('"just a string"');
    expect(parseSuggestionResponse(raw)).toEqual({});
  });
});
