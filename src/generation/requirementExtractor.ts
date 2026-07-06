import Anthropic from "@anthropic-ai/sdk";
import { SkillCategory } from "../core/types";

export interface RequirementExtractionInput {
  /** Raw requirements text (e.g. a BRD converted to text). */
  text: string;
  /** Optional title for context. */
  title?: string;
  /** Optional module/domain context to ground extraction. */
  moduleContext?: string;
  /** Requested test scope, e.g. ["Functional", "Negative / Edge"]. */
  scopeTypes?: string[];
  /** Free-text notes to steer scope. */
  scopeNotes?: string;
  /** Model override. Defaults to TCGEN_MODEL or claude-sonnet-4-6. */
  model?: string;
}

/**
 * Decomposes free-form requirements text into a structured skills inventory
 * that the generation engine can consume. Pure text in — no PDF handling — so
 * the library stays dependency-light.
 */
export async function extractSkillsFromText(
  input: RequirementExtractionInput,
  apiKey?: string
): Promise<SkillCategory[]> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic({ apiKey: key });
  const model = input.model || process.env.TCGEN_MODEL || "claude-sonnet-4-6";

  const system = `You are a QA analyst. You read requirements and decompose them
into atomic, testable skills grouped into categories.

Return ONLY valid JSON (no markdown) as an array of categories in this shape:
[
  {
    "categoryId": "SHORT_CODE",
    "categoryName": "Human readable category",
    "categoryDescription": "one line",
    "skills": [
      {
        "skillId": "CODE_001",
        "skillName": "Concise action-oriented name",
        "description": "what this verifies",
        "actionType": "Navigation|Input|Click|Verification|Workflow|API",
        "steps": ["ordered user actions"],
        "expectedResult": "measurable outcome",
        "testData": {},
        "elementSelectors": {}
      }
    ]
  }
]

Rules:
- Each skill is one atomic, independently testable unit.
- steps are user actions, expectedResult is a measurable outcome.
- Only include skills relevant to the requested scope.
- Prefer 1-6 skills per category. Omit empty testData/elementSelectors keys.`;

  const scope =
    input.scopeTypes && input.scopeTypes.length > 0
      ? input.scopeTypes.join(", ")
      : "functional";

  const user = `${input.title ? `TITLE: ${input.title}\n\n` : ""}REQUESTED TEST SCOPE: ${scope}
${input.scopeNotes ? `SCOPE NOTES: ${input.scopeNotes}\n` : ""}${
    input.moduleContext ? `MODULE CONTEXT:\n${input.moduleContext}\n\n` : ""
  }REQUIREMENTS:
"""
${truncate(input.text, 24000)}
"""

Extract the skills inventory now. Return ONLY the JSON array.`;

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    temperature: 0.4,
    system,
    messages: [{ role: "user", content: user }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Unexpected non-text response from extractor.");
  }
  const cleaned = block.text.replace(/```(?:json)?/gi, "");
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Extractor did not return a JSON array.");
  return JSON.parse(match[0]) as SkillCategory[];
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}
