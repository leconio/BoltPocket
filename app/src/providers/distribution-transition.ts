type DistributionTransitionHandler = () => Promise<void>;

const activeHandlers = new Set<DistributionTransitionHandler>();

export function registerDistributionTransitionHandler(
  handler: DistributionTransitionHandler,
) {
  activeHandlers.add(handler);
  return () => {
    activeHandlers.delete(handler);
  };
}

export async function prepareForDistributionTransition() {
  const operations = [...activeHandlers].map((handler) => {
    try {
      return handler();
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const results = await Promise.allSettled(operations);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Distribution transition shutdown failed.",
    );
  }
}
