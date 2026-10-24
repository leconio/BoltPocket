export type ConnectorErrorCode =
  | "not_connected"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "invalid_approval"
  | "approval_expired"
  | "approval_replayed"
  | "recovery_failed"
  | "io_failure";

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
