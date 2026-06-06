import { parseMetaToolParams } from './params.js';

describe('parseMetaToolParams', () => {
  it('accepts list_tools operation', () => {
    expect(parseMetaToolParams({ operation: 'list_tools' }).operation).toBe('list_tools');
  });

  it('requires tool_name for describe_tool at runtime', () => {
    expect(parseMetaToolParams({ operation: 'describe_tool', tool_name: 'filesystem' }).tool_name).toBe(
      'filesystem',
    );
  });
});
