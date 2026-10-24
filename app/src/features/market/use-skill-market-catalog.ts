import { useCallback, useEffect, useRef, useState } from "react";

import type { SkillMarketCatalog } from "@/application/ports/skill-market";
import { useAppServices } from "@/providers/runtime-services-provider";

export function useSkillMarketCatalog(active: boolean) {
  const {
    capabilityCatalogRegion,
    skillMarket,
    skillMarketPublisherBlocklist,
  } = useAppServices();
  const request = useRef<AbortController | null>(null);
  const [catalog, setCatalog] = useState<SkillMarketCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(
    () =>
      skillMarketPublisherBlocklist.subscribe(() => {
        setFailed(false);
        setCatalog(null);
        setRequestVersion((value) => value + 1);
      }),
    [skillMarketPublisherBlocklist],
  );

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    void Promise.all([
      skillMarket.loadCatalog(capabilityCatalogRegion, controller.signal),
      skillMarketPublisherBlocklist.list(),
    ]).then(
      ([next, blockedPublisherIds]) => {
        if (!controller.signal.aborted) {
          setFailed(false);
          const blocked = new Set(blockedPublisherIds);
          setCatalog({
            ...next,
            entries: next.entries.filter(
              ({ publisherId }) => !blocked.has(publisherId),
            ),
          });
        }
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [
    active,
    capabilityCatalogRegion,
    requestVersion,
    skillMarket,
    skillMarketPublisherBlocklist,
  ]);

  const retry = useCallback(() => {
    setFailed(false);
    setCatalog(null);
    setRequestVersion((value) => value + 1);
  }, []);

  return { catalog, failed, loading: catalog === null && !failed, retry };
}
