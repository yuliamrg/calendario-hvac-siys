function hasManualActivityOrder(activity) {
  return Number.isFinite(Number(activity?.sortOrder));
}

export function compareActivityOrder(leftActivity, rightActivity) {
  const leftHasOrder = hasManualActivityOrder(leftActivity);
  const rightHasOrder = hasManualActivityOrder(rightActivity);
  if (leftHasOrder || rightHasOrder) {
    if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
    const orderDifference = Number(leftActivity.sortOrder) - Number(rightActivity.sortOrder);
    if (orderDifference) return orderDifference;
  }
  const completedDifference = Number(leftActivity.status === "completed") - Number(rightActivity.status === "completed");
  return completedDifference ||
    String(leftActivity.createdAt ?? "").localeCompare(String(rightActivity.createdAt ?? "")) ||
    leftActivity.id.localeCompare(rightActivity.id);
}
