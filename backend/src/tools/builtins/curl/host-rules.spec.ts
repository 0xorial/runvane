import { isLocalHost, matchesHostList } from './host-rules.js';

describe('curl host-rules', () => {
  describe('isLocalHost', () => {
    it.each([
      'localhost',
      '0.0.0.0',
      '127.0.0.1',
      '127.5.4.3',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254', // AWS/GCP metadata
      '169.254.1.1', // link-local generally
      'box.local',
      '::1', // IPv6 loopback
      '::', // IPv6 unspecified
      'fe80::1', // IPv6 link-local
      'febf::abcd',
      'fc00::1', // IPv6 unique-local
      'fd12:3456::1',
      '2130706433', // bare integer == 127.0.0.1
    ])('blocks local/private host %s', (host) => {
      expect(isLocalHost(host)).toBe(true);
    });

    it.each([
      'example.com',
      'api.github.com',
      '8.8.8.8',
      '172.15.0.1', // just below the private 172.16/12 range
      '172.32.0.1', // just above it
      '169.253.0.1', // not link-local
      '2606:4700:4700::1111', // public IPv6 (Cloudflare)
      'fd-server.example.com', // hostname that merely starts with "fd"
      'fe80-host.example.com',
    ])('allows public host %s', (host) => {
      expect(isLocalHost(host)).toBe(false);
    });
  });

  describe('matchesHostList', () => {
    it('matches exact and wildcard entries case-insensitively', () => {
      expect(matchesHostList('api.example.com', ['API.example.com'])).toBe(true);
      expect(matchesHostList('api.example.com', ['*.example.com'])).toBe(true);
      expect(matchesHostList('example.com', ['*.example.com'])).toBe(false);
      expect(matchesHostList('evil.com', ['*.example.com', 'good.com'])).toBe(false);
      expect(matchesHostList('host', [''])).toBe(false);
    });
  });
});
