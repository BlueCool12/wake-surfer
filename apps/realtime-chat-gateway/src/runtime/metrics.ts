import type { MetricsPort } from "@wake-surfer/realtime-chat/gateway";

export function createNoopMetrics(): MetricsPort {
  return {
    increment() {
      // metrics exporter is not wired in the first gateway shell.
    },
  };
}
