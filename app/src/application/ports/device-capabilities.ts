export const DEVICE_CAPABILITY_IDS = [
  "device-status",
  "power",
  "storage",
  "network",
  "location",
  "wifi",
  "bluetooth",
  "local-network",
  "external-apps",
  "calendar",
  "reminders",
  "sensors",
  "audio",
] as const;

export type DeviceCapabilityId = (typeof DEVICE_CAPABILITY_IDS)[number];

export type DeviceCapabilityPolicy = "allow" | "ask" | "deny";

export type DeviceCapabilitySettings = Readonly<
  Record<DeviceCapabilityId, DeviceCapabilityPolicy>
>;

export const DEVICE_ACTIONS = [
  "status",
  "power",
  "storage",
  "network",
  "location_current",
  "wifi_current",
  "wifi_scan",
  "bluetooth_scan",
  "bluetooth_services",
  "bluetooth_read",
  "bluetooth_subscribe",
  "bluetooth_write",
  "bluetooth_recover",
  "http_request",
  "tcp_exchange",
  "udp_exchange",
  "profiles",
  "profile_execute",
  "profile_recover",
  "external_app_open",
  "calendar_list",
  "calendar_events",
  "calendar_create",
  "calendar_update",
  "calendar_delete",
  "calendar_recover",
  "reminder_list",
  "reminder_create",
  "reminder_update",
  "reminder_delete",
  "reminder_recover",
  "sensors_list",
  "sensor_read",
  "audio_play",
  "audio_pause",
  "audio_resume",
  "audio_seek",
  "audio_status",
  "audio_stop",
] as const;

export type AgentDeviceAction = (typeof DEVICE_ACTIONS)[number];

export type AgentDeviceCapabilityInput = Readonly<{
  action: AgentDeviceAction;
  purpose: string;
  profileId?: string;
  profileActionId?: string;
  deviceId?: string;
  recoveryId?: string;
  serviceUuid?: string;
  characteristicUuid?: string;
  valueBase64?: string;
  valueText?: string;
  url?: string;
  method?: "GET" | "HEAD";
  host?: string;
  port?: number;
  requestBase64?: string;
  requestText?: string;
  maxResponseBytes?: number;
  timeoutMs?: number;
  durationMs?: number;
  calendarId?: string;
  eventId?: string;
  reminderId?: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  title?: string;
  notes?: string;
  location?: string;
  timeZone?: string;
  allDay?: boolean;
  completed?: boolean;
  maxResults?: number;
  sensorType?: string;
  intervalMs?: number;
  positionSeconds?: number;
  volume?: number;
  loop?: boolean;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  playbackId?: string;
}>;

export type AgentDeviceCapabilityContext = Readonly<{
  conversationId: string;
  projectId: string;
  projectName: string;
  runId: string;
  profilesDocument?: string;
}>;

export type PendingDeviceCapabilityAccess = Readonly<{
  requestId: string;
  capability: DeviceCapabilityId;
  action: AgentDeviceAction;
  projectId: string;
  projectName: string;
  conversationId: string;
  purpose: string;
  dataDescription: string;
  requestedAt: string;
}>;

export interface DeviceCapabilityAccessApprovalPort {
  request(
    input: Omit<PendingDeviceCapabilityAccess, "requestId" | "requestedAt">,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

export interface AgentDeviceCapabilityPort {
  execute(
    input: AgentDeviceCapabilityInput,
    context: AgentDeviceCapabilityContext,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>>;
}
