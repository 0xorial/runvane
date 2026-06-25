import { parsePlannerOutput } from '../plannerTextParsing.js';
import { buildPlannerSyntaxRegistry } from './index.js';

// Build tokens from raw codepoints so the test exercises the true DeepSeek
// bytes (U+FF5C ｜, U+2581 ▁), independent of how glyphs render in the editor.
const BAR = String.fromCharCode(0xff5c);
const SEP = String.fromCharCode(0x2581);
const CALLS_BEGIN = `<${BAR}tool${SEP}calls${SEP}begin${BAR}>`;
const CALL_BEGIN = `<${BAR}tool${SEP}call${SEP}begin${BAR}>`;
const CALL_END = `<${BAR}tool${SEP}call${SEP}end${BAR}>`;
const CALLS_END = `<${BAR}tool${SEP}calls${SEP}end${BAR}>`;
const TOOL_SEP = `<${BAR}tool${SEP}sep${BAR}>`;

const call = (name: string, argsJson: string): string =>
  `${CALL_BEGIN}function${TOOL_SEP}${name}\n` + '```json\n' + argsJson + '\n```' + CALL_END;

describe('DeepSeek V3/R1 (deepseek)', () => {
  it('parses the canonical begin/sep/fence/end format and keeps prose', () => {
    const raw = 'Let me check.' + CALLS_BEGIN + call('get_weather', '{"city":"Tokyo"}') + CALLS_END;
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('Let me check.');
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_weather', toolRequest: '{"city":"Tokyo"}' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('parses multiple calls', () => {
    const raw = CALLS_BEGIN + call('search', '{"q":"cats"}') + call('get_time', '{}') + CALLS_END;
    expect(parsePlannerOutput(raw).toolRequests).toEqual([
      { toolName: 'search', toolRequest: '{"q":"cats"}' },
      { toolName: 'get_time', toolRequest: '{}' },
    ]);
  });

  it('waits while args are still streaming, then locks deepseek', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    const partial = CALLS_BEGIN + `${CALL_BEGIN}function${TOOL_SEP}get_weather\n` + '```json\n{"city":"Tok';
    expect(selector.observe(partial)).toBeNull();

    const full = CALLS_BEGIN + call('get_weather', '{"city":"Tokyo"}') + CALLS_END;
    expect(selector.observe(full)?.name).toBe('deepseek');
  });
});
