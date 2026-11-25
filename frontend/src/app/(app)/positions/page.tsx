import OrgUnitPage from '@/components/OrgUnitPage';

export default function PositionsPage() {
  return (
    <OrgUnitPage
      title="Positions"
      singular="Position"
      description="Job titles or roles assigned to employees."
      resource="positions"
      prefix="position"
      parentKey="parent_position"
    />
  );
}
