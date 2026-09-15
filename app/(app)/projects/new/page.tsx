import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

import { ProjectForm } from "../project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireUser("/projects/new");

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        eyebrow="Step 1 of 3"
        title="Create a project"
        description="Next you'll add the scope you agreed with this client, then you can start assessing their requests against it."
      />

      <Card className="p-5">
        <ProjectForm />
      </Card>
    </div>
  );
}
