import type { AgentThirdPartyCapabilityPort } from "@/application/ports/third-party-capabilities";

export class AgentThirdPartyCapabilityBridge implements AgentThirdPartyCapabilityPort {
  #delegate?: AgentThirdPartyCapabilityPort;

  bind(delegate: AgentThirdPartyCapabilityPort) {
    this.#delegate = delegate;
    return () => {
      if (this.#delegate === delegate) this.#delegate = undefined;
    };
  }

  assess(...parameters: Parameters<AgentThirdPartyCapabilityPort["assess"]>) {
    if (!this.#delegate) {
      return Promise.reject(new Error("第三方能力安装服务尚未就绪。"));
    }
    return this.#delegate.assess(...parameters);
  }

  hasAssessmentAwaitingConfirmation(
    ...parameters: Parameters<
      AgentThirdPartyCapabilityPort["hasAssessmentAwaitingConfirmation"]
    >
  ) {
    return (
      this.#delegate?.hasAssessmentAwaitingConfirmation(...parameters) ?? false
    );
  }

  install(...parameters: Parameters<AgentThirdPartyCapabilityPort["install"]>) {
    if (!this.#delegate) {
      return Promise.reject(new Error("第三方能力安装服务尚未就绪。"));
    }
    return this.#delegate.install(...parameters);
  }
}
