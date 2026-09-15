import Link from "next/link";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isFixtureMode, modelFor } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getConfirmedVersion, getProject } from "@/lib/data/projects";

import { RequestCaptureForm } from "./request-capture";
import { RequestForm } from "./request-form";

export const metadata = { title: "New request" };

export default async function NewRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/projects/${id}/requests/new`);

  const [project, baseline] = await Promise.all([
    getProject(user.id, id),
    getConfirmedVersion(user.id, id),
  ]);

  // Analysis cannot begin until a baseline is confirmed (plan §4).
  if (!baseline) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow={<Link href={`/projects/${id}`}>{project.name}</Link>}
          title="Confirm your scope first"
        />
        <EmptyState
          title="No confirmed baseline"
          description="ScopeGuard compares client requests against a scope you have checked and confirmed. Add the agreement and confirm what it commits you to, then come back."
          action={
            <ButtonLink href={`/projects/${id}/scope`} variant="primary">
              Add the agreed scope
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={<Link href={`/projects/${id}`}>{project.name}</Link>}
        title="Capture the client's request"
        description={`It will be compared against baseline version ${baseline.version}. One message can contain several separate requests — each becomes its own reviewable item.`}
      />

      <Card className="p-5">
        <Tabs defaultValue="paste">
          <TabsList aria-label="How the request arrived" className="mb-4">
            <TabsTrigger value="paste">Paste the message</TabsTrigger>
            <TabsTrigger value="capture">Voice, video, or screenshot</TabsTrigger>
          </TabsList>
          <TabsContent value="paste">
            <RequestForm
              projectId={id}
              modelLabel={isFixtureMode() ? "fixture mode" : modelFor("analyze")}
            />
          </TabsContent>
          <TabsContent value="capture">
            <RequestCaptureForm
              projectId={id}
              modelLabel={isFixtureMode() ? "fixture mode" : modelFor("analyze")}
              transcriptionAvailable={!isFixtureMode()}
            />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
