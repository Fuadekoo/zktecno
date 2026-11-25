import OrgUnitPage from '@/components/OrgUnitPage';

export default function AreasPage() {
  return (
    <OrgUnitPage
      title="Areas"
      singular="Area"
      description="Areas group devices. Employees are sent to every device in the areas they belong to."
      resource="areas"
      prefix="area"
      parentKey="parent_area"
    />
  );
}
