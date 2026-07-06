import { TestCaseGenerator, GenerationResult } from "./generation/generator";
import { SkillParser } from "./core/skillParser";
import { ConfigManager } from "./config/configManager";
import {
  Skill,
  SkillCategory,
  GenerationConfig,
  GoldenTestCase,
  AppMetadata,
  PromptContext,
} from "./core/types";
import {
  extractSkillsFromText,
  RequirementExtractionInput,
} from "./generation/requirementExtractor";

export type PresetName = "minimal" | "standard" | "comprehensive";

export interface GenerateOptions {
  /** Anthropic API key. Falls back to process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Named preset controlling coverage, style and evaluation. */
  preset?: PresetName;
  /** Fine-grained config overrides applied on top of the preset. */
  config?: Partial<GenerationConfig>;
  /** Few-shot golden examples to steer quality. */
  goldenExamples?: GoldenTestCase[];
  /** Application/domain context injected into prompts. */
  appContext?: AppMetadata;
}

function buildGenerator(options: GenerateOptions): TestCaseGenerator {
  const config = ConfigManager.getConfig(options.preset, options.config);
  const context: PromptContext = {
    goldenDataset: options.goldenExamples,
    appContext: options.appContext ?? config.appContext,
  };
  return new TestCaseGenerator(config, context, options.apiKey);
}

/**
 * Generate test cases from a flat list of skills.
 *
 * @example
 * const { testCases } = await generateTestCases(skills, { preset: "standard" });
 */
export async function generateTestCases(
  skills: Skill[],
  options: GenerateOptions = {}
): Promise<GenerationResult> {
  return buildGenerator(options).generate(skills);
}

/**
 * Generate from a skills inventory — either a JSON string or parsed categories.
 */
export async function generateFromInventory(
  inventory: string | SkillCategory[],
  options: GenerateOptions = {}
): Promise<GenerationResult> {
  const parser = new SkillParser();
  const categories =
    typeof inventory === "string"
      ? parser.parseSkillInventory(inventory)
      : inventory;
  const skills = parser.flatten(categories);
  return buildGenerator(options).generate(skills);
}

export interface GenerateFromTextResult extends GenerationResult {
  /** The skills the requirements were decomposed into before generation. */
  skills: Skill[];
}

/**
 * One-shot: turn requirements text (e.g. a BRD) into scored test cases.
 * Extracts a skills inventory with the LLM, then generates and scores.
 */
export async function generateFromText(
  input: RequirementExtractionInput,
  options: GenerateOptions = {}
): Promise<GenerateFromTextResult> {
  const categories = await extractSkillsFromText(input, options.apiKey);
  const parser = new SkillParser();
  const skills = parser.flatten(categories);
  if (skills.length === 0) {
    throw new Error("No testable skills were extracted from the text.");
  }
  const result = await buildGenerator(options).generate(skills);
  return { ...result, skills };
}
