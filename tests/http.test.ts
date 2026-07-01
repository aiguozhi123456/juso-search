import { describe, it, expect } from 'vitest';
import { mapStatus } from '@/lib/providers/http';

describe('mapStatus', () => {
  it('returns null for 2xx', () => {
    expect(mapStatus(200, 'X')).toBeNull();
  });

  it('maps 401 to unauthorized', () => {
    expect(mapStatus(401, 'X')?.kind).toBe('unauthorized');
  });

  it('maps 403 to unauthorized', () => {
    expect(mapStatus(403, 'X')?.kind).toBe('unauthorized');
  });

  it('maps 429 to rateLimit', () => {
    expect(mapStatus(429, 'X')?.kind).toBe('rateLimit');
  });

  it('maps 5xx to provider', () => {
    expect(mapStatus(502, 'X')?.kind).toBe('provider');
  });

  it('maps other 4xx to provider', () => {
    expect(mapStatus(422, 'X')?.kind).toBe('provider');
  });
});
