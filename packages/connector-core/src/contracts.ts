export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ConnectorCapability =
  | "list"
  | "search"
  | "read-text"
  | "create-text"
  | "write-text"
  | "trash"
  | "recovery";

export type ConnectorDescriptor = {
  id: string;
  label: string;
  kind: string;
  accountId: string;
  accountLabel: string;
  status: "connected" | "attention" | "disconnected";
  projectIds: string[];
  capabilities: ConnectorCapability[];
  writeMode?: "atomic" | "recoverable";
};

export type ConnectorResourceRef = {
  connectorId: string;
  accountId: string;
  resourceId: string;
  projectId: string;
  kind: string;
  displayName: string;
  locator: string;
};

export type TextResourceSnapshot = {
  ref: ConnectorResourceRef;
  mediaType: string;
  text: string;
  version: string;
  metadata: Record<string, JsonValue>;
};

export type ListResourcesInput = {
  projectId: string;
};

export type SearchResourcesInput = {
  projectId: string;
  query: string;
  limit?: number;
};

export type TextChangeProposal = {
  id: string;
  patchHash: string;
  ref: ConnectorResourceRef;
  baseVersion: string;
  before: string;
  after: string;
  summary: string;
};

export type ApprovalGrant = {
  id: string;
  proposalId: string;
  patchHash: string;
  connectorId: string;
  accountId: string;
  resourceId: string;
  baseVersion: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type RecoveryPoint = {
  id: string;
  ref: ConnectorResourceRef;
  version: string;
  createdAt: string;
  storageRef: string;
};

export type ApplyTextChangeResult = {
  ref: ConnectorResourceRef;
  previousVersion: string;
  version: string;
  recoveryPoint: RecoveryPoint;
  appliedAt: string;
};

export type ApplyTextCreateResult = ApplyTextChangeResult & {
  snapshot: TextResourceSnapshot;
};

export interface ProjectConnector {
  descriptor(): ConnectorDescriptor;
  list(input: ListResourcesInput): Promise<ConnectorResourceRef[]>;
  search(input: SearchResourcesInput): Promise<ConnectorResourceRef[]>;
  read(ref: ConnectorResourceRef): Promise<TextResourceSnapshot>;
  validateTextChange(proposal: TextChangeProposal): Promise<void>;
  applyTextChange(
    proposal: TextChangeProposal,
    approval: ApprovalGrant,
  ): Promise<ApplyTextChangeResult>;
  validateTextCreate?(proposal: TextChangeProposal): Promise<void>;
  applyTextCreate?(
    proposal: TextChangeProposal,
    approval: ApprovalGrant,
  ): Promise<ApplyTextCreateResult>;
}
