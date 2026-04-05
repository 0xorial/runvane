export type HealthResponse = {
  status: "ok";
  service: string;
  queue_depth: number;
};

export function buildHealthResponse(queueDepth: number): HealthResponse {
  return {
    status: "ok",
    service: "runvane-backend",
    queue_depth: queueDepth,
  };
}
