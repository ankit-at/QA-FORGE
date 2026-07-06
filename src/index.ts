// Public library entry point.
//
// High-level helpers:
//   import { generateTestCases, generateFromInventory, generateFromText } from "test-case-generator";
//
// Low-level building blocks are exported too for advanced use.

export {
  generateTestCases,
  generateFromInventory,
  generateFromText,
} from "./api";
export type {
  GenerateOptions,
  GenerateFromTextResult,
  PresetName,
} from "./api";

// Core building blocks
export { TestCaseGenerator } from "./generation/generator";
export type { GenerationResult } from "./generation/generator";
export { SkillParser } from "./core/skillParser";
export { PromptBuilder } from "./core/promptBuilder";
export { ClaudeClient } from "./core/claudeClient";
export { OutputFormatter } from "./generation/outputFormatter";
export { EvaluationEngine } from "./evaluation/evaluator";
export {
  ConfigManager,
  DEFAULT_CONFIG,
  PRESETS,
} from "./config/configManager";
export {
  extractSkillsFromText,
} from "./generation/requirementExtractor";
export type { RequirementExtractionInput } from "./generation/requirementExtractor";

// Types
export type {
  Skill,
  SkillCategory,
  EnrichedSkill,
  Complexity,
  AppMetadata,
  GenerationConfig,
  GoldenTestCase,
  PromptContext,
  TestMetadata,
  GeneratedTestCase,
  GenerationError,
  EvaluationScore,
  QualityReport,
} from "./core/types";
