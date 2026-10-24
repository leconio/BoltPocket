import {
  GoogleWorkspaceTextConnector,
  type GoogleWorkspaceTextConnectorOptions,
} from "@boltpocket/connector-google-workspace";
import {
  ConnectorError,
  type TextChangeProposal,
} from "@boltpocket/connector-core";

import type {
  GoogleSlidesApiPort,
  GoogleSlidesRecoveryStore,
} from "./contracts.ts";
import { googlePresentationUrl } from "./google-slides-link.ts";
import {
  canonicalizeGoogleSlidesText,
  MAX_GOOGLE_SLIDES_CHARACTERS,
} from "./google-slides-text.ts";

export type GoogleSlidesResourceDefinition = {
  id: string;
  projectId: string;
  presentationId: string;
  displayName: string;
  locator: string;
  writable: boolean;
};

export type GoogleSlidesConnectorOptions = Omit<
  GoogleWorkspaceTextConnectorOptions,
  "api" | "profile" | "recovery" | "resources"
> & {
  resources: GoogleSlidesResourceDefinition[];
  api: GoogleSlidesApiPort;
  recovery: GoogleSlidesRecoveryStore;
};

export class GoogleSlidesConnector extends GoogleWorkspaceTextConnector {
  constructor(options: GoogleSlidesConnectorOptions) {
    super({
      ...options,
      resources: options.resources.map((resource) => ({
        id: resource.id,
        projectId: resource.projectId,
        providerResourceId: resource.presentationId,
        displayName: resource.displayName,
        locator: resource.locator,
        writable: resource.writable,
      })),
      profile: {
        descriptorKind: "google-slides",
        resourceKind: "google-slide",
        resourceNoun: "Google presentation",
        mediaType: "application/json",
        metadataIdKey: "presentationId",
        maximumCharacters: MAX_GOOGLE_SLIDES_CHARACTERS,
        resourceUrl: googlePresentationUrl,
      },
    });
  }

  override async validateTextChange(proposal: TextChangeProposal) {
    assertCanonicalSlides(proposal.after);
    await super.validateTextChange(proposal);
  }

  override async validateTextCreate(proposal: TextChangeProposal) {
    assertCanonicalSlides(proposal.after);
    await super.validateTextCreate(proposal);
  }
}

function assertCanonicalSlides(value: string) {
  if (canonicalizeGoogleSlidesText(value) !== value) {
    throw new ConnectorError(
      "unsupported",
      "Google 幻灯片内容必须保持规范 JSON 格式。",
    );
  }
}
