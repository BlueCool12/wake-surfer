import type { MetricsPort } from "@wake-surfer/realtime-chat/api";

export function createNoopMetrics(): MetricsPort {
  return {
    increment() {
      // metrics exporter is not wired in the first API shell.
    },
  };
}
