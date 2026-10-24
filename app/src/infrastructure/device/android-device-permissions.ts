export type AndroidBluetoothPermissionName =
  | "android.permission.ACCESS_FINE_LOCATION"
  | "android.permission.BLUETOOTH_CONNECT"
  | "android.permission.BLUETOOTH_SCAN";

export function androidBluetoothPermissionNames(
  apiLevel: number,
): AndroidBluetoothPermissionName[] {
  return apiLevel >= 31
    ? [
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
      ]
    : ["android.permission.ACCESS_FINE_LOCATION"];
}
