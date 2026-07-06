#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { TestCaseGenerator } from "./generation/generator";
import { OutputFormatter } from "./generation/outputFormatter";
import { EvaluationEngine } from "./evaluation/evaluator";
import { ConfigManager } from "./config/configManager";
import { PromptBuilder } from "./core/promptBuilder";
import { ClaudeClient } from "./core/claudeClient";
import { GoldenTestCase, PromptContext } from "./core/types";

interface CliArgs {
  source: string;
  preset: string;
  outDir: string;
  golden?: string;
  noEval: boolean;
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.source)) {
    fail(`Source file not found: ${args.source}`);
  }

  const json = fs.readFileSync(args.source, "utf-8");
  const { skills } = TestCaseGenerator.parse(json);
  console.log(`Loaded ${skills.length} skill(s) from ${args.source}`);

  const overrides = args.noEval ? { evaluate: false } : {};
  const config = ConfigManager.getConfig(args.preset, overrides);
  console.log(
    `Preset: ${args.preset} | model: ${config.model} | evaluate: ${config.evaluate}`
  );

  const context: PromptContext = {
    goldenDataset: loadGolden(args.golden),
    appContext: config.appContext,
  };

  const generator = new TestCaseGenerator(config, context);
  const { testCases, errors } = await generator.generate(skills);

  if (testCases.length === 0) {
    fail("No test cases were generated.");
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const formatter = new OutputFormatter();
  const wantAll = config.outputFormat === "all";

  if (wantAll || config.outputFormat === "playwright") {
    const p = path.join(args.outDir, "generated.spec.ts");
    fs.writeFileSync(p, formatter.formatPlaywright(testCases));
    console.log(`Wrote ${p}`);
  }
  if (wantAll || config.outputFormat === "json") {
    const p = path.join(args.outDir, "test-cases.json");
    fs.writeFileSync(p, formatter.formatJSON(testCases));
    console.log(`Wrote ${p}`);
  }
  if (wantAll || config.outputFormat === "xlsx") {
    const p = path.join(args.outDir, "test-cases.xlsx");
    fs.writeFileSync(p, await formatter.formatXLSX(testCases));
    console.log(`Wrote ${p}`);
  }

  // Quality report (only meaningful when evaluation ran).
  const evaluator = new EvaluationEngine(
    new ClaudeClient(config),
    new PromptBuilder()
  );
  const report = evaluator.buildReport(testCases);
  const reportPath = path.join(args.outDir, "quality-report.json");
  fs.writeFileSync(reportPath, formatter.formatReport(report));
  console.log(`Wrote ${reportPath}`);

  console.log("\n=== Summary ===");
  console.log(`Generated: ${testCases.length}/${skills.length}`);
  if (config.evaluate) console.log(`Average score: ${report.averageScore}/100`);
  if (errors.length > 0) {
    console.log(`Failed: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e.skillId}: ${e.error}`));
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    source: "examples/skills-inventory.json",
    preset: "standard",
    outDir: "output",
    noEval: false,
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      case "--source":
        args.source = argv[++i];
        break;
      case "--preset":
        args.preset = argv[++i];
        break;
      case "--out":
        args.outDir = argv[++i];
        break;
      case "--golden":
        args.golden = argv[++i];
        break;
      case "--no-eval":
        args.noEval = true;
        break;
      default:
        positional.push(a);
    }
  }

  // Backwards-friendly positional form: tcgen <source> <preset>
  if (positional[0]) args.source = positional[0];
  if (positional[1]) args.preset = positional[1];

  if (!ConfigManager.presetNames().includes(args.preset)) {
    fail(
      `Unknown preset "${args.preset}". Choose one of: ${ConfigManager.presetNames().join(", ")}`
    );
  }
  return args;
}

function loadGolden(file?: string): GoldenTestCase[] {
  if (!file) return [];
  if (!fs.existsSync(file)) fail(`Golden dataset not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as GoldenTestCase[];
}

/** Minimal .env loader so we avoid an extra dependency. */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function printHelp(): void {
  console.log(`Test Case Generator

Usage:
  tcgen [--source <file>] [--preset <name>] [--out <dir>] [--golden <file>] [--no-eval]
  tcgen <source> <preset>

Options:
  --source   Skills inventory JSON (default: examples/skills-inventory.json)
  --preset   ${ConfigManager.presetNames().join(" | ")} (default: standard)
  --out      Output directory (default: output)
  --golden   Optional golden dataset JSON for few-shot prompting
  --no-eval  Skip LLM-as-judge evaluation
  -h,--help  Show this help

Environment:
  ANTHROPIC_API_KEY   required
  TCGEN_MODEL         optional model override
`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// Only run when executed directly (not when imported).
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err?.message ?? err);
    process.exit(1);
  });
}

export { main as runCli };
