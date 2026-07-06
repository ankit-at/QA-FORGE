import db from "../db";
import { extractSkillsFromText } from "../../src/generation/requirementExtractor";
import { TestCaseGenerator } from "../../src/generation/generator";
import { SkillParser } from "../../src/core/skillParser";
import { ConfigManager } from "../../src/config/configManager";
import { PromptContext } from "../../src/core/types";

export interface RunRequest {
  userId: number;
  title: string;
  brdText: string;
  brdFilename?: string;
  moduleContextId?: number;
  scopeTypes: string[];
  scopeNotes?: string;
}

export interface RunOutcome {
  runId: number;
  testCaseCount: number;
  avgScore: number | null;
}

/**
 * End-to-end: BRD text -> skills inventory -> generated + scored test cases,
 * persisted as a run with its test cases.
 */
export async function runGeneration(req: RunRequest): Promise<RunOutcome> {
  let moduleContextText: string | undefined;
  if (req.moduleContextId) {
    const ctx = db
      .prepare("SELECT context_text FROM module_contexts WHERE id = ?")
      .get(req.moduleContextId) as { context_text: string } | undefined;
    moduleContextText = ctx?.context_text;
  }

  const scope = { types: req.scopeTypes, notes: req.scopeNotes || "" };

  // Insert the run in a processing state first so it always has a row.
  const insert = db
    .prepare(
      `INSERT INTO runs (title, user_id, module_context_id, brd_filename, brd_text, scope, status)
       VALUES (?, ?, ?, ?, ?, ?, 'processing')`
    )
    .run(
      req.title,
      req.userId,
      req.moduleContextId ?? null,
      req.brdFilename ?? null,
      req.brdText,
      JSON.stringify(scope)
    );
  const runId = Number(insert.lastInsertRowid);

  try {
    const categories = await extractSkillsFromText({
      text: req.brdText,
      moduleContext: moduleContextText,
      scopeTypes: req.scopeTypes,
      scopeNotes: req.scopeNotes,
      title: req.title,
    });

    const parser = new SkillParser();
    const skills = parser.flatten(categories);
    if (skills.length === 0) {
      throw new Error("No testable skills were extracted from the BRD.");
    }

    const config = ConfigManager.getConfig("standard");
    const context: PromptContext = {
      appContext: moduleContextText
        ? { description: moduleContextText }
        : undefined,
    };
    const generator = new TestCaseGenerator(config, context);
    const { testCases } = await generator.generate(skills);

    if (testCases.length === 0) {
      throw new Error("Generation produced no test cases.");
    }

    const insertTc = db.prepare(
      `INSERT INTO test_cases
        (run_id, skill_id, test_name, code, steps, assertions, tags, priority, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const scores: number[] = [];
    const tx = db.transaction(() => {
      for (const tc of testCases) {
        insertTc.run(
          runId,
          tc.skillId,
          tc.metadata.testName,
          tc.code,
          JSON.stringify(tc.metadata.steps),
          JSON.stringify(tc.metadata.assertions),
          JSON.stringify(tc.metadata.tags),
          tc.metadata.priority,
          tc.evaluation?.overallScore ?? null
        );
        if (tc.evaluation) scores.push(tc.evaluation.overallScore);
      }
    });
    tx();

    const avg =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    db.prepare(
      `UPDATE runs SET status='completed', avg_score=?, test_case_count=?, error=NULL WHERE id=?`
    ).run(avg, testCases.length, runId);

    return { runId, testCaseCount: testCases.length, avgScore: avg };
  } catch (err) {
    const message = (err as Error).message;
    db.prepare(`UPDATE runs SET status='failed', error=? WHERE id=?`).run(
      message,
      runId
    );
    throw err;
  }
}
