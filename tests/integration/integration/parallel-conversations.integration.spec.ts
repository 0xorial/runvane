import { retainSharedTestApp } from '../support/shared-app';
import {
  assertProbeShape,
  createConversation,
  entryTypesInOrder,
  getDefaultAgentId,
  INTEGRATION_LLM_TIMEOUT_MS,
  postProbeMessage,
  waitForProbeCompletion,
} from '../support/http';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('parallel conversations (integration)', () => {
  let baseUrl: string;
  let agentId: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    agentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  it('time-travels: two probe runs interleave without losing entries', async () => {
    const convA = await createConversation(baseUrl);
    const convB = await createConversation(baseUrl);

    await Promise.all([
      postProbeMessage(baseUrl, convA, agentId),
      postProbeMessage(baseUrl, convB, agentId),
    ]);

    const [entriesA, entriesB] = await Promise.all([
      waitForProbeCompletion(baseUrl, convA),
      waitForProbeCompletion(baseUrl, convB),
    ]);
    assertProbeShape(entryTypesInOrder(entriesA));
    assertProbeShape(entryTypesInOrder(entriesB));
  }, INTEGRATION_LLM_TIMEOUT_MS + 5_000);
});
