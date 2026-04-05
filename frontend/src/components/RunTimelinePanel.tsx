import { cancelRunById, pauseRunById, resumeRunPauseById } from "../api/client";
import { AsyncButton } from "./ui/AsyncButton";

type RunStep = {
  id: number;
  step_index: number;
  kind: string;
  status: string;
  summary: string;
};

type RunRow = { id: string; status?: string; user_message?: string; cancel_requested?: boolean; pause_requested?: boolean };

type RunTimelinePanelProps = {
  runs: RunRow[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  runSteps: RunStep[];
  onRefresh?: () => void;
};

export function RunTimelinePanel({
  runs,
  selectedRunId,
  onSelectRun,
  runSteps,
  onRefresh,
}: RunTimelinePanelProps) {
  async function cancelRun() {
    if (!selectedRunId) return false;
    await cancelRunById(selectedRunId);
    onRefresh?.();
    return true;
  }
  async function pauseRun() {
    if (!selectedRunId) return false;
    await pauseRunById(selectedRunId);
    onRefresh?.();
    return true;
  }
  async function resumePause() {
    if (!selectedRunId) return false;
    await resumeRunPauseById(selectedRunId);
    onRefresh?.();
    return true;
  }

  return (
    <aside className="run-panel">
      <div className="run-panel-header">Run timeline</div>
      <div className="run-actions">
        <AsyncButton
          className="run-action-btn"
          onClickAsync={cancelRun}
          disabled={!selectedRunId}
        >
          Cancel run
        </AsyncButton>
        <AsyncButton
          className="run-action-btn"
          onClickAsync={pauseRun}
          disabled={!selectedRunId}
        >
          Pause
        </AsyncButton>
        <AsyncButton
          className="run-action-btn"
          onClickAsync={resumePause}
          disabled={!selectedRunId}
        >
          Resume pause
        </AsyncButton>
      </div>
      <div className="run-list">
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`run-item ${selectedRunId === r.id ? "active" : ""}`}
            onClick={() => onSelectRun(r.id)}
          >
            <div>
              {r.status}
              {r.cancel_requested ? " · cancel req" : ""}
              {r.pause_requested ? " · pause req" : ""}
            </div>
            <div className="run-preview">{r.user_message}</div>
          </button>
        ))}
      </div>
      <div className="step-list">
        {runSteps.map((s) => (
          <div key={s.id} className={`step ${s.status}`}>
            <div>
              #{s.step_index} {s.kind} · {s.status}
            </div>
            <div className="step-summary">{s.summary}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
