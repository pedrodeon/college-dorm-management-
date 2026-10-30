import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle } from "@/components/ui/typography";
import { MaintenanceForm } from "@/components/maintenance-form";

export const metadata = { title: "New maintenance request — Tudor Hall" };

export default function NewMaintenancePage() {
  return (
    <section>
      {/* Back goes home: /maintenance bounces an RA straight back here. */}
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Maintenance request</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Tudor Hall · describe the problem and where it is.
      </p>

      <Card variant="sheet" className="mt-6">
        <MaintenanceForm />
      </Card>
    </section>
  );
}
