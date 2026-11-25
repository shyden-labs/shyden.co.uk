import { describe, expect, it } from 'vitest';
import { validate, type OpenApiDoc } from '../openapi-contract';

const DOC: OpenApiDoc = { openapi: '3.1.0', paths: {} };
const NAME = { type: 'string', minLength: 1, maxLength: 3 };

describe('validate reads the length a schema gives a string (#390 F54)', () => {
  it('passes a string inside its lengths', () => {
    expect(validate(DOC, NAME, 'abc', 'body')).toEqual([]);
  });

  it('names a string longer than its maxLength', () => {
    expect(validate(DOC, NAME, 'abcd', 'body')).toEqual([
      'body: 4 characters, the spec allows at most 3',
    ]);
  });

  it('names a string shorter than its minLength', () => {
    expect(validate(DOC, NAME, '', 'body')).toEqual([
      'body: 0 characters, the spec needs at least 1',
    ]);
  });

  it('reads a property inside an object the same way', () => {
    const schema = { type: 'object', properties: { name: NAME } };
    expect(validate(DOC, schema, { name: 'abcd' }, 'body')).toEqual([
      'body.name: 4 characters, the spec allows at most 3',
    ]);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(validate(DOC, NAME, 'ไทย', 'body')).toEqual([]);
    expect(
      validate(DOC, { type: 'string', maxLength: 2 }, '😀😀', 'body'),
    ).toEqual([]);
  });
});
