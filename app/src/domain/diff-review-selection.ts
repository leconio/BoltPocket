export function isDiffHunkAccepted(
  rejectedHunkIds: readonly string[],
  hunkId: string,
) {
  return !rejectedHunkIds.includes(hunkId);
}

export function getDiffHunkToggleAction(accepted: boolean) {
  return accepted ? "reject" : "accept";
}

export function toggleRejectedDiffHunk(
  rejectedHunkIds: readonly string[],
  hunkId: string,
) {
  const next = new Set(rejectedHunkIds);
  if (next.has(hunkId)) next.delete(hunkId);
  else next.add(hunkId);
  return [...next].sort((left, right) => left.localeCompare(right, "en"));
}
