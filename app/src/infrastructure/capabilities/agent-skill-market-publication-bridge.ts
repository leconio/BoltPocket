import type { AgentSkillMarketPublicationPort } from "@/application/ports/skill-market-publication";

export class AgentSkillMarketPublicationBridge implements AgentSkillMarketPublicationPort {
  #delegate?: AgentSkillMarketPublicationPort;

  bind(delegate: AgentSkillMarketPublicationPort) {
    this.#delegate = delegate;
    return () => {
      if (this.#delegate === delegate) this.#delegate = undefined;
    };
  }

  hasReviewAwaitingPublication(
    ...parameters: Parameters<
      AgentSkillMarketPublicationPort["hasReviewAwaitingPublication"]
    >
  ) {
    return this.#delegate?.hasReviewAwaitingPublication(...parameters) ?? false;
  }

  review(...parameters: Parameters<AgentSkillMarketPublicationPort["review"]>) {
    if (!this.#delegate) {
      return Promise.reject(
        new Error("Skill publication service is not ready."),
      );
    }
    return this.#delegate.review(...parameters);
  }

  publish(
    ...parameters: Parameters<AgentSkillMarketPublicationPort["publish"]>
  ) {
    if (!this.#delegate) {
      return Promise.reject(
        new Error("Skill publication service is not ready."),
      );
    }
    return this.#delegate.publish(...parameters);
  }
}
