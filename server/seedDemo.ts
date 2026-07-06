// One-off demo data seeder for screenshots. Safe to re-run: it clears demo
// rows first. Run with: ts-node --project server/tsconfig.json server/seedDemo.ts
import "./env";
import db, { seedAdmin } from "./db";
import bcrypt from "bcryptjs";

seedAdmin();

function upsertUser(email: string, name: string, role: "admin" | "generator") {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)"
    )
    .run(email, bcrypt.hashSync("demopass123", 10), name, role);
  return Number(info.lastInsertRowid);
}

const adminId = (db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get() as { id: number }).id;
const ankit = upsertUser("ankit@example.com", "Ankit Tiwari", "generator");
const priya = upsertUser("priya@example.com", "Priya Nair", "generator");

// Reset demo contexts and runs.
db.prepare("DELETE FROM test_cases").run();
db.prepare("DELETE FROM runs").run();
db.prepare("DELETE FROM module_contexts").run();

function ctx(name: string, description: string, text: string) {
  return Number(
    db
      .prepare(
        "INSERT INTO module_contexts (name, description, context_text, created_by) VALUES (?, ?, ?, ?)"
      )
      .run(name, description, text, adminId).lastInsertRowid
  );
}

const payroll = ctx(
  "Payroll",
  "Salary processing, statutory compliance",
  "The Payroll module processes monthly salary runs including PF, ESIC, PT and TDS. Off-cycle and full-and-final settlements are supported. Pay slips are generated per employee."
);
const recruitment = ctx(
  "Recruitment",
  "Requisitions, candidates, offers",
  "Recruitment covers requisition approval, job posting, candidate shortlisting, interview scheduling and offer letter generation."
);
const shop = ctx(
  "Let's Shop storefront",
  "E-commerce dashboard, cart, checkout",
  "Angular SPA storefront. Shoppers authenticate, browse a product grid, filter, add to cart and check out."
);

interface DemoCase {
  skillId: string;
  name: string;
  steps: string[];
  tags: string[];
  priority: string;
  score: number;
  code: string;
}

function run(
  title: string,
  userId: number,
  contextId: number,
  scopeTypes: string[],
  cases: DemoCase[],
  createdAt: string
) {
  const avg = Math.round(cases.reduce((a, c) => a + c.score, 0) / cases.length);
  const runId = Number(
    db
      .prepare(
        `INSERT INTO runs (title, user_id, module_context_id, brd_filename, brd_text, scope, status, avg_score, test_case_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
      )
      .run(
        title,
        userId,
        contextId,
        `${title.replace(/\s+/g, "_")}_BRD.pdf`,
        "Business requirements document text…",
        JSON.stringify({ types: scopeTypes, notes: "" }),
        avg,
        cases.length,
        createdAt
      ).lastInsertRowid
  );
  const stmt = db.prepare(
    `INSERT INTO test_cases (run_id, skill_id, test_name, code, steps, assertions, tags, priority, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of cases) {
    stmt.run(
      runId,
      c.skillId,
      c.name,
      c.code,
      JSON.stringify(c.steps),
      JSON.stringify([]),
      JSON.stringify(c.tags),
      c.priority,
      c.score
    );
  }
}

run(
  "Checkout — payment flow",
  ankit,
  shop,
  ["Functional", "Negative / Edge"],
  [
    {
      skillId: "CHK_001",
      name: "should complete checkout with a valid card and show the order confirmation",
      steps: [
        "Add a product to the cart",
        "Open the cart and proceed to checkout",
        "Enter valid shipping details",
        "Enter a valid test card and place the order",
        "Verify the order confirmation and order number are shown",
      ],
      tags: ["checkout", "smoke", "critical"],
      priority: "critical",
      score: 92,
      code: `test('should complete checkout with a valid card and show the order confirmation', async ({ page }) => {
  const cart = new CartPage(page);
  await cart.addFirstProduct();
  await cart.goToCheckout();

  await page.getByPlaceholder('Select Country').fill('India');
  await page.getByRole('button', { name: 'PLACE ORDER' }).click();

  await expect(page.locator('.hero-primary')).toHaveText(/THANKYOU FOR THE ORDER/i);
  await expect(page.locator('.em-spacer-1 ._567b7d')).not.toBeEmpty();
});`,
    },
    {
      skillId: "CHK_002",
      name: "should reject an invalid card and keep the user on the payment step",
      steps: [
        "Proceed to the payment step with items in the cart",
        "Enter an invalid card number",
        "Attempt to place the order",
        "Verify a validation error is displayed",
      ],
      tags: ["checkout", "negative"],
      priority: "high",
      score: 84,
      code: `test('should reject an invalid card and keep the user on the payment step', async ({ page }) => {
  const checkout = new CheckoutPage(page);
  await checkout.gotoWithItem();

  await checkout.fillCard('0000 0000 0000 0000');
  await checkout.placeOrder();

  await expect(page.getByText('Invalid card')).toBeVisible();
  await expect(page).toHaveURL(/order/);
});`,
    },
    {
      skillId: "CHK_003",
      name: "should block checkout when the cart is empty",
      steps: [
        "Navigate to checkout with an empty cart",
        "Verify the user cannot place an order",
      ],
      tags: ["checkout", "edge"],
      priority: "medium",
      score: 79,
      code: `test('should block checkout when the cart is empty', async ({ page }) => {
  await page.goto('/dashboard/cart');
  await expect(page.getByText('No Items in Your Cart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Checkout' })).toBeHidden();
});`,
    },
  ],
  "2026-07-05 09:14:00"
);

run(
  "Employee sign-in and dashboard",
  ankit,
  shop,
  ["Functional"],
  [
    {
      skillId: "AUTH_001",
      name: "should sign in with valid credentials and land on the dashboard",
      steps: [
        "Open the login page",
        "Enter a valid email and password",
        "Submit the login form",
        "Verify redirect to the dashboard",
      ],
      tags: ["auth", "smoke"],
      priority: "critical",
      score: 95,
      code: `test('should sign in with valid credentials and land on the dashboard', async ({ page }) => {
  await page.goto('/auth/login');
  await page.locator('#userEmail').fill(process.env.RSA_EMAIL!);
  await page.locator('#userPassword').fill(process.env.RSA_PASSWORD!);
  await page.locator('#login').click();

  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator("button[aria-label='HOME']")).toBeVisible();
});`,
    },
    {
      skillId: "AUTH_002",
      name: "should show an error for invalid credentials",
      steps: [
        "Open the login page",
        "Enter an incorrect password",
        "Submit and verify the error toast",
      ],
      tags: ["auth", "negative"],
      priority: "high",
      score: 88,
      code: `test('should show an error for invalid credentials', async ({ page }) => {
  await page.goto('/auth/login');
  await page.locator('#userEmail').fill('user@example.com');
  await page.locator('#userPassword').fill('wrong-password');
  await page.locator('#login').click();

  await expect(page.locator('[role="alert"]')).toContainText('Incorrect');
});`,
    },
  ],
  "2026-07-04 16:40:00"
);

run(
  "Monthly payroll run",
  priya,
  payroll,
  ["Functional", "Non-functional"],
  [
    {
      skillId: "PAY_001",
      name: "should process a regular payroll run and lock the period",
      steps: [
        "Open the payroll dashboard for the current period",
        "Trigger a regular payroll run",
        "Wait for processing to complete",
        "Verify totals and lock the period",
      ],
      tags: ["payroll", "critical"],
      priority: "critical",
      score: 90,
      code: `test('should process a regular payroll run and lock the period', async ({ page }) => {
  const payroll = new PayrollPage(page);
  await payroll.openPeriod('2026-07');
  await payroll.runRegular();
  await payroll.waitForCompletion();

  await expect(payroll.status).toHaveText('Completed');
  await payroll.lockPeriod();
  await expect(payroll.lockBadge).toBeVisible();
});`,
    },
    {
      skillId: "PAY_002",
      name: "should generate a pay slip for each active employee",
      steps: [
        "Complete a payroll run",
        "Generate pay slips",
        "Verify one pay slip exists per active employee",
      ],
      tags: ["payroll", "reports"],
      priority: "high",
      score: 82,
      code: `test('should generate a pay slip for each active employee', async ({ page }) => {
  const payroll = new PayrollPage(page);
  const active = await payroll.activeEmployeeCount();
  await payroll.generatePayslips();

  await expect(payroll.payslipRows).toHaveCount(active);
});`,
    },
  ],
  "2026-07-03 11:05:00"
);

run(
  "Offer letter generation",
  priya,
  recruitment,
  ["Functional"],
  [
    {
      skillId: "REC_001",
      name: "should generate an offer letter from an approved requisition",
      steps: [
        "Open an approved candidate in the pipeline",
        "Create an offer proposal",
        "Generate the offer letter",
        "Verify the letter contains the correct compensation",
      ],
      tags: ["recruitment", "offer"],
      priority: "high",
      score: 86,
      code: `test('should generate an offer letter from an approved requisition', async ({ page }) => {
  const offer = new OfferPage(page);
  await offer.openCandidate('C-1042');
  await offer.createProposal({ ctc: 1800000 });
  await offer.generateLetter();

  await expect(offer.letterPreview).toContainText('18,00,000');
});`,
    },
  ],
  "2026-07-02 14:22:00"
);

console.log("Demo data seeded.");
