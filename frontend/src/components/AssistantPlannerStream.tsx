import {
  extractStreamingFinalAnswerContent,
  extractStreamingToolCallName,
  isStreamingFinalAnswer,
} from "../utils/plannerStreamParse";

type AssistantPlannerStreamProps = {
  text: string;
  embedded?: boolean;
};

/** Live planner LLM tokens; same shells as ThinkingComponent / persisted segments. */
export function AssistantPlannerStream({
  text,
  embedded = false,
}: AssistantPlannerStreamProps) {
  if (!text) return null;

  const finalRoute = isStreamingFinalAnswer(text);
  const liveContent = finalRoute
    ? extractStreamingFinalAnswerContent(text)
    : null;
  const toolNamePartial = !finalRoute
    ? extractStreamingToolCallName(text)
    : null;

  const inner = (
    <div className="run-progress">
      <div className="run-progress__thought-box run-progress__thought-box--active">
        <div className="run-progress__thought-title">Thinking…</div>
        <div className="run-progress__thought-nested">
          {finalRoute ? (
            <div className="run-plan-final run-plan-final--streaming">
              <div className="run-plan-final__head">
                <span className="run-plan-final__label">Final answer</span>
                <span className="run-plan-final__badge">streaming</span>
              </div>
              <div className="run-plan-final__body">
                {liveContent !== null ? liveContent : "…"}
              </div>
            </div>
          ) : (
            <>
              {toolNamePartial != null ? (
                <div className="run-progress__thought-outcome run-progress__thought-outcome--pending">
                  <div className="run-progress__thought-outcome-head">
                    <span className="run-progress__thought-outcome-label">
                      Decision
                    </span>
                    <span className="mono run-progress__thought-outcome-tool">
                      {toolNamePartial || "tool_call"}
                    </span>
                    <span className="run-plan-final__badge">streaming</span>
                  </div>
                </div>
              ) : null}
              <pre className="run-progress__thought-outcome-fallback mono">
                {text}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) return inner;
  return <div className="msg assistant">{inner}</div>;
}
