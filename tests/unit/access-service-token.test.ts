import { describe, expect, it } from 'vitest';
import { accessServiceHeaders } from '../access-service-token';

// prod-sanity reaches production's private report health check with the
// Access service token held in the `prod` environment (#782). A run without
// it must say which setting is missing, not fail later as a bare 403.
describe('accessServiceHeaders: the service token as the headers Access reads', () => {
  it('sends the id and the secret under the names Access reads', () => {
    expect(
      accessServiceHeaders({
        CF_ACCESS_CLIENT_ID: 'id.access',
        CF_ACCESS_CLIENT_SECRET: 'secret',
      }),
    ).toEqual({
      'CF-Access-Client-Id': 'id.access',
      'CF-Access-Client-Secret': 'secret',
    });
  });

  it('names the id when it is missing', () => {
    expect(() =>
      accessServiceHeaders({ CF_ACCESS_CLIENT_SECRET: 'secret' }),
    ).toThrow('CF_ACCESS_CLIENT_ID is not set');
  });

  it('names the secret when it is missing', () => {
    expect(() =>
      accessServiceHeaders({ CF_ACCESS_CLIENT_ID: 'id.access' }),
    ).toThrow('CF_ACCESS_CLIENT_SECRET is not set');
  });

  it('names both when both are missing', () => {
    expect(() => accessServiceHeaders({})).toThrow(
      'CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET is not set',
    );
  });

  it('counts an empty value as missing', () => {
    expect(() =>
      accessServiceHeaders({
        CF_ACCESS_CLIENT_ID: '',
        CF_ACCESS_CLIENT_SECRET: 'secret',
      }),
    ).toThrow('CF_ACCESS_CLIENT_ID is not set');
  });
});
