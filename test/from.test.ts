import { describe, expect, it } from 'vitest';
import { resolveFrom, toSendAddress } from '../src/sandbox-entry';

// Minimal PluginContext stand-in: resolveFrom only reads KV and the site name.
function ctx(kv: Record<string, string>, siteName?: string) {
  return {
    kv: { get: async (key: string) => kv[key] ?? null },
    site: siteName === undefined ? undefined : { name: siteName },
  } as never;
}

describe('toSendAddress', () => {
  it('passes a nameless address as a plain string', () => {
    expect(toSendAddress('a@example.com', undefined)).toBe('a@example.com');
    expect(toSendAddress('a@example.com', '')).toBe('a@example.com');
  });

  it('passes a named address as an object', () => {
    expect(toSendAddress('a@example.com', 'Site')).toEqual({ email: 'a@example.com', name: 'Site' });
  });
});

describe('resolveFrom', () => {
  it('never returns an object without a name (Cloudflare rejects it)', async () => {
    const from = await resolveFrom(ctx({ 'settings:fromAddress': 'contact@example.org' }));
    expect(from).toBe('contact@example.org');
  });

  it('treats a blank site name as no name', async () => {
    const from = await resolveFrom(ctx({ 'settings:fromAddress': 'contact@example.org' }, '  '));
    expect(from).toBe('contact@example.org');
  });

  it('prefers the display name setting', async () => {
    const from = await resolveFrom(
      ctx({ 'settings:fromAddress': 'Embedded <contact@example.org>', 'settings:displayName': 'Setting' }, 'Site'),
    );
    expect(from).toEqual({ email: 'contact@example.org', name: 'Setting' });
  });

  it('falls back to the name in the From value, then the site name', async () => {
    expect(await resolveFrom(ctx({ 'settings:fromAddress': 'Embedded <contact@example.org>' }, 'Site'))).toEqual({
      email: 'contact@example.org',
      name: 'Embedded',
    });
    expect(await resolveFrom(ctx({ 'settings:fromAddress': 'contact@example.org' }, 'Site'))).toEqual({
      email: 'contact@example.org',
      name: 'Site',
    });
  });

  it('throws when the From address is not configured', async () => {
    await expect(resolveFrom(ctx({}))).rejects.toThrow(/not configured/);
  });
});
