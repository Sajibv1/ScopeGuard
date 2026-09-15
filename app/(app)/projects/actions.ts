"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { CURRENCIES, messageFor, type FormState } from "@/lib/forms";
import { MoneyError, parseNonNegative, toDbNumeric } from "@/lib/money";
import { createProject, deleteProject, updateProject } from "@/lib/data/projects";
import { recordEvent } from "@/lib/data/requests";

function parseProjectForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const clientName = String(formData.get("clientName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const currency = String(formData.get("currency") ?? "USD")
    .trim()
    .toUpperCase();
  const rateInput = String(formData.get("defaultRate") ?? "").trim();

  const fieldErrors: Record<string, string> = {};

  if (name.length === 0) fieldErrors.name = "Give the project a name.";
  if (name.length > 200) fieldErrors.name = "Keep the name under 200 characters.";
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    fieldErrors.currency = "Choose a supported currency.";
  }

  let defaultRate: string | null = null;
  try {
    defaultRate = toDbNumeric(parseNonNegative(rateInput, "Default hourly rate"));
  } catch (error) {
    fieldErrors.defaultRate =
      error instanceof MoneyError ? error.message : "Enter a valid hourly rate.";
  }

  return {
    fieldErrors,
    values: {
      name,
      clientName: clientName || null,
      description: description || null,
      currency,
      defaultRate,
    },
  };
}

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const { fieldErrors, values } = parseProjectForm(formData);

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  let projectId: string;
  try {
    const project = await createProject(user.id, values);
    projectId = project.id;
    await recordEvent(user.id, {
      projectId: project.id,
      event: "Project created",
      note: project.name,
    });
  } catch (error) {
    return { error: messageFor(error) };
  }

  revalidatePath("/dashboard");
  // redirect() throws, so it must sit outside the try block.
  redirect(`/projects/${projectId}/scope`);
}

export async function updateProjectAction(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const { fieldErrors, values } = parseProjectForm(formData);

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  try {
    await updateProject(user.id, projectId, values);
  } catch (error) {
    return { error: messageFor(error) };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

export async function deleteProjectAction(projectId: string): Promise<void> {
  const user = await requireUser();
  await deleteProject(user.id, projectId);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
