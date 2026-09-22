"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import { useDataset } from "@/lib/dataset-context";
import { buildEntityCatalog } from "@/lib/entity-registry";
import { subscribeCatalog } from "@/lib/catalog-invalidation";
import { getSavedPlaybookSummaries } from "@/lib/playbook-store";
import { getScouts } from "@/lib/scout-data";
import type { DetectableEntity } from "@/lib/entity-types";

interface EntityCatalogContextValue {
  entityCatalog: DetectableEntity[];
  runCatalog: DetectableEntity[];
  entityLookup: Map<string, DetectableEntity>;
  handleEntityClick: (entity: DetectableEntity) => void;
}

const EntityCatalogContext = createContext<EntityCatalogContextValue | null>(null);

export function EntityCatalogProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { segments, funnels, retentions } = useSidebarContext();
  const { datasetId } = useDataset();

  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => subscribeCatalog(() => setCatalogVersion((v) => v + 1)), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion is intentional: it's the version-counter pattern that forces the memo to rebuild after a store mutation. ESLint can't see the indirect dependency.
  const entityCatalog = useMemo(() => buildEntityCatalog(datasetId, segments, "₹", funnels, retentions), [datasetId, segments, funnels, retentions, catalogVersion]);

  const runCatalog = useMemo<DetectableEntity[]>(() => {
    const saved = getSavedPlaybookSummaries().map((pb) => ({
      id: `run-pb-${pb.id}`,
      type: "playbook" as const,
      name: pb.name,
      description: pb.description,
      stat: pb.lastRun || "",
      contextPayload: { prompt: pb.name, playbookId: pb.id },
    }));
    const scoutPlaybooks = getScouts().map((s) => ({
      id: `scout-pb-${s.id}`,
      type: "playbook" as const,
      name: s.playbook.name,
      description: s.description,
      stat: `Scout: ${s.name}`,
      contextPayload: { prompt: s.prompt },
    }));
    return [...saved, ...scoutPlaybooks];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion is intentional: version-counter pattern forces rebuild after store mutations.
  }, [catalogVersion]);

  const entityLookup = useMemo(
    () => new Map(entityCatalog.map((e) => [e.name.toLowerCase(), e])),
    [entityCatalog],
  );

  const handleEntityClick = useCallback(
    (entity: DetectableEntity) => {
      if (entity.route) {
        router.push(entity.route);
      } else if (entity.type === "table") {
        router.push("/catalog");
      }
    },
    [router],
  );

  const value = useMemo(
    () => ({ entityCatalog, runCatalog, entityLookup, handleEntityClick }),
    [entityCatalog, runCatalog, entityLookup, handleEntityClick],
  );

  return (
    <EntityCatalogContext.Provider value={value}>
      {children}
    </EntityCatalogContext.Provider>
  );
}

export function useEntityCatalog(): EntityCatalogContextValue {
  const ctx = useContext(EntityCatalogContext);
  if (!ctx) throw new Error("useEntityCatalog must be used within EntityCatalogProvider");
  return ctx;
}
