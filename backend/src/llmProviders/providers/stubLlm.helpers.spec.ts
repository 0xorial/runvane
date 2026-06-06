import {
  abortableDelay,
  isSteerProbeMessage,
  parseStubDelayMs,
  steerProbeReply,
} from './stubLlm.helpers.js';

describe('stubLlm.helpers', () => {
  it('parseStubDelayMs reads embedded delay marker', () => {
    expect(parseStubDelayMs('hello __stub_delay:250__ world')).toBe(250);
    expect(parseStubDelayMs('no marker')).toBeNull();
  });

  it('abortableDelay rejects when signal aborts', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(500, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('steer probe reply is deterministic', () => {
    expect(isSteerProbeMessage('please __steer_probe__ now')).toBe(true);
    expect(steerProbeReply()).toContain('Steered response.');
  });
});
