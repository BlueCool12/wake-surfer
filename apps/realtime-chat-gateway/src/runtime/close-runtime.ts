export type GatewayRuntimeResources = {
  closeApp: () => Promise<void>;
  closeRuntime: () => Promise<void>;
};

export async function closeGatewayRuntime(resources: GatewayRuntimeResources): Promise<void> {
  const errors: unknown[] = [];

  try {
    await resources.closeApp();
  } catch (error) {
    errors.push(error);
  }

  try {
    await resources.closeRuntime();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "실시간 채팅 게이트웨이 종료 실패");
  }
}
