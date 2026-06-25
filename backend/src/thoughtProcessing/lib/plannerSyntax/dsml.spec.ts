import { parsePlannerOutput } from '../plannerTextParsing.js';
import { buildPlannerSyntaxRegistry } from './index.js';

const BAR = String.fromCharCode(0xff5c); // ｜ U+FF5C
const tag = (deco: string, body: string): string => `<${BAR}${deco}${BAR}${body}`;

// The exact shape reported from the model: <｜DSML｜tool_calls> + invoke/parameter.
const sample =
  "The current time is **2026-06-25T16:06:02 UTC**. That's Coordinated Universal Time, " +
  "which suggests the server is likely configured to UTC. I can also check the filesystem " +
  'for any clues about the host system.\n\n' +
  `<${BAR}DSML${BAR}tool_calls>\n` +
  `<${BAR}DSML${BAR}invoke name="bash">\n` +
  `<${BAR}DSML${BAR}parameter name="tool_request" string="true">Check hostname, OS info, and environment variables to determine where I'm running.</${BAR}DSML${BAR}parameter>\n` +
  `<${BAR}DSML${BAR}parameter name="source" string="true">planner_tool_request</${BAR}DSML${BAR}parameter>\n` +
  `</${BAR}DSML${BAR}invoke>\n` +
  `</${BAR}DSML${BAR}tool_calls>`;

describe('DSML invoke/parameter XML (dsml)', () => {
  it('parses the reported <｜DSML｜tool_calls> bash call and keeps the prose', () => {
    const parsed = parsePlannerOutput(sample);
    expect(parsed.toolRequests).toEqual([
      {
        toolName: 'bash',
        toolRequest: 'Check hostname, OS info, and environment variables to determine where I\'m running.',
      },
    ]);
    expect(parsed.assistantOutput.startsWith('The current time is')).toBe(true);
    expect(parsed.assistantOutput.includes('<')).toBe(false); // tool block stripped from prose
    expect(parsed.followup).toBe('continue');
  });

  it('parses multiple invokes and excludes the source param from the request', () => {
    const raw =
      `<${BAR}DSML${BAR}tool_calls>` +
      `<${BAR}DSML${BAR}invoke name="get_current_time">` +
      `<${BAR}DSML${BAR}parameter name="tool_request">now, full detail</${BAR}DSML${BAR}parameter>` +
      `</${BAR}DSML${BAR}invoke>` +
      `<${BAR}DSML${BAR}invoke name="search">` +
      `<${BAR}DSML${BAR}parameter name="query">penguins</${BAR}DSML${BAR}parameter>` +
      `</${BAR}DSML${BAR}invoke>` +
      `</${BAR}DSML${BAR}tool_calls>`;
    expect(parsePlannerOutput(raw).toolRequests).toEqual([
      { toolName: 'get_current_time', toolRequest: 'now, full detail' },
      { toolName: 'search', toolRequest: 'penguins' },
    ]);
  });

  it('tolerates the double-bar tag decoration (<｜｜DSML｜｜…>)', () => {
    const raw =
      `<${BAR}${BAR}DSML${BAR}${BAR}tool_calls>` +
      `<${BAR}${BAR}DSML${BAR}${BAR}invoke name="bash">` +
      `<${BAR}${BAR}DSML${BAR}${BAR}parameter name="tool_request">ls -la</${BAR}${BAR}DSML${BAR}${BAR}parameter>` +
      `</${BAR}${BAR}DSML${BAR}${BAR}invoke>` +
      `</${BAR}${BAR}DSML${BAR}${BAR}tool_calls>`;
    expect(parsePlannerOutput(raw).toolRequests).toEqual([{ toolName: 'bash', toolRequest: 'ls -la' }]);
  });

  it('waits on an unclosed invoke then locks the dsml syntax', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    const partial = tag('DSML', 'tool_calls>') + tag('DSML', 'invoke name="bash">') + tag('DSML', 'parameter name="tool_request">ls');
    expect(selector.observe(partial)).toBeNull();
    expect(selector.observe(partial + `</${BAR}DSML${BAR}parameter></${BAR}DSML${BAR}invoke>`)?.name).toBe('dsml');
  });
});
