import OrgUnitPage from '@/components/OrgUnitPage';

export default function DepartmentsPage() {
  return (
    <OrgUnitPage
      title="Departments"
      singular="Department"
      description="Organise employees into departments (e.g. classes, teams or offices)."
      resource="departments"
      prefix="dept"
      parentKey="parent_dept"
    />
  );
}
