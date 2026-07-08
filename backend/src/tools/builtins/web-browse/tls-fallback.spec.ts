import { isMidRequestDrop } from '../../fetch-failure.js';
import { isTlsSuspectScrapeFailure, wwwApexVariant } from './tool.js';

describe('web_browse TLS www↔apex fallback', () => {
  it('flags cert/ssl/aborted scrape failures as TLS-suspect', () => {
    expect(isTlsSuspectScrapeFailure('net::ERR_ABORTED at https://www.protobiology.org/peoplem.php')).toBe(true);
    expect(isTlsSuspectScrapeFailure('net::ERR_CERT_COMMON_NAME_INVALID at https://x.test/')).toBe(true);
    expect(isTlsSuspectScrapeFailure('net::ERR_SSL_PROTOCOL_ERROR')).toBe(true);
    expect(isTlsSuspectScrapeFailure('net::ERR_NAME_NOT_RESOLVED at https://x.test/')).toBe(false);
    expect(isTlsSuspectScrapeFailure('net::ERR_CONNECTION_REFUSED')).toBe(false);
    expect(isTlsSuspectScrapeFailure('504 Gateway Timeout')).toBe(false);
  });

  it('flips www → apex and apex → www, preserving path/query/port', () => {
    expect(wwwApexVariant('https://www.protobiology.org/peoplem.php')).toBe('https://protobiology.org/peoplem.php');
    expect(wwwApexVariant('https://protobiology.org/a?b=c#d')).toBe('https://www.protobiology.org/a?b=c#d');
    expect(wwwApexVariant('https://www.example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  it('declines hosts with no sensible sibling', () => {
    expect(wwwApexVariant('http://www.example.com/')).toBe(null); // no cert on http
    expect(wwwApexVariant('https://localhost/x')).toBe(null);
    expect(wwwApexVariant('https://10.0.0.5/x')).toBe(null);
    expect(wwwApexVariant('https://[::1]/x')).toBe(null);
    expect(wwwApexVariant('not a url')).toBe(null);
  });

  it('classifies mid-request socket drops distinctly from unreachable services', () => {
    const withCode = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
    expect(isMidRequestDrop(withCode('ECONNRESET'))).toBe(true);
    expect(isMidRequestDrop(withCode('UND_ERR_SOCKET'))).toBe(true);
    expect(isMidRequestDrop(withCode('EPIPE'))).toBe(true);
    expect(isMidRequestDrop(withCode('ECONNREFUSED'))).toBe(false);
    expect(isMidRequestDrop(withCode('ENOTFOUND'))).toBe(false);
    expect(isMidRequestDrop(new Error('anything else'))).toBe(false);
  });
});
