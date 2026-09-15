"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { NotesIntakeForm } from "./notes-form";
import { PdfUploadForm } from "./pdf-upload";
import { ScopeIntakeForm } from "./scope-intake";
import { TranscriptIntakeForm } from "./transcript-form";

/**
 * Scope intake with four routes in (plan Feature 3, §10).
 *
 * Paste is P0 and stays the default: it always works, needs no extraction,
 * and is the fallback every PDF failure message points back to. The
 * transcript route exists because many baselines are agreed on a call, not
 * in a document. The notes route exists for the call that produced neither
 * a recording nor a document — it captures memory as unverified items and
 * a recap to send, never as evidence.
 *
 * Every panel stays mounted (forceMount + hidden when inactive): peeking at
 * another tab must not destroy a long pasted transcript or notes draft.
 */
export function ScopeIntakeTabs({ projectId }: { projectId: string }) {
  return (
    <Tabs defaultValue="paste">
      <TabsList aria-label="How to add your scope" className="mb-4">
        <TabsTrigger value="paste">Paste text</TabsTrigger>
        <TabsTrigger value="pdf">Upload a PDF</TabsTrigger>
        <TabsTrigger value="transcript">Call transcript</TabsTrigger>
        <TabsTrigger value="notes">Call notes</TabsTrigger>
      </TabsList>
      <TabsContent value="paste" forceMount className="data-[state=inactive]:hidden">
        <ScopeIntakeForm projectId={projectId} />
      </TabsContent>
      <TabsContent value="pdf" forceMount className="data-[state=inactive]:hidden">
        <PdfUploadForm projectId={projectId} />
      </TabsContent>
      <TabsContent value="transcript" forceMount className="data-[state=inactive]:hidden">
        <TranscriptIntakeForm projectId={projectId} />
      </TabsContent>
      <TabsContent value="notes" forceMount className="data-[state=inactive]:hidden">
        <NotesIntakeForm projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
