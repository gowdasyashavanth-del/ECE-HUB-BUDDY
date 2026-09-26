import { useParams } from "react-router-dom";
import { ENTITY_CONFIGS } from "./entityConfigs";
import { AcademicEntityManager } from "../../../components/admin/AcademicEntityManager";
import { EmptyState } from "../../../components/ui/EmptyState";

export function AcademicEntityPage() {
  const { entityKey } = useParams<{ entityKey: string }>();
  const config = entityKey ? ENTITY_CONFIGS[entityKey] : undefined;

  if (!config) {
    return (
      <EmptyState
        title="Unknown academic entity"
        message="This management page doesn't exist. Use the sidebar to navigate to a valid section."
      />
    );
  }

  // key= forces a full remount when navigating between entity pages
  // (e.g. Regulations -> Programs), so each page's internal state
  // (open form, selected row) doesn't leak into the next.
  return <AcademicEntityManager key={config.key} config={config} />;
}
