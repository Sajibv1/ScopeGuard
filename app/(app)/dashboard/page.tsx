import Link from "next/link";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/data/projects";
import { formatDate } from "@/lib/documents/render";

export const metadata = { title: "Projects" };

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const projects = await listProjects(user.id);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project holds one agreed scope baseline and the change requests assessed against it."
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            New project
          </ButtonLink>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project, add the scope you agreed with your client, and you can start assessing their requests against it."
          action={
            <div className="flex gap-2">
              <ButtonLink href="/projects/new" variant="primary">
                Create a project
              </ButtonLink>
              <ButtonLink href="/demo">Try the sample</ButtonLink>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Card className="h-full transition-colors hover:border-input">
                <Link href={`/projects/${project.id}`} className="block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{project.name}</p>
                      {project.clientName ? (
                        <p className="truncate text-sm text-muted-foreground">{project.clientName}</p>
                      ) : null}
                    </div>
                    {project.isSample ? (
                      <span className="shrink-0 rounded-full border border-notice-warn-br bg-notice-warn-bg px-2 py-0.5 text-xs font-medium text-notice-warn-fg">
                        Sample data
                      </span>
                    ) : null}
                  </div>

                  <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Scope status</dt>
                      <dd className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`inline-block size-1.5 rounded-full ${
                            project.hasConfirmedScope ? "bg-ok" : "bg-muted-foreground/50"
                          }`}
                        />
                        {project.hasConfirmedScope ? "Scope confirmed" : "No confirmed scope"}
                      </dd>
                    </div>

                    <div>
                      <dt className="sr-only">Open change requests</dt>
                      <dd>
                        {project.openRequestCount} open request
                        {project.openRequestCount === 1 ? "" : "s"}
                      </dd>
                    </div>

                    <div>
                      <dt className="sr-only">Last updated</dt>
                      <dd>Updated {formatDate(project.updatedAt)}</dd>
                    </div>
                  </dl>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
