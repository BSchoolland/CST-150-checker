import { Database } from "bun:sqlite";

// Assignment types
export interface AssignmentPart {
  id: number;
  assignment_id: number;
  part_number: number;
  title: string;
  description: string;
  requirements: string; // JSON array of requirement strings
  review_criteria: string; // Specific criteria for AI review
}

export interface Assignment {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface AssignmentWithParts extends Assignment {
  parts: AssignmentPart[];
}

// Initialize database
const DB_PATH = process.env.DB_PATH || "./data/assignments.db";

// Ensure data directory exists
import { mkdirSync } from "fs";
import { dirname } from "path";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  // Directory may already exist
}

const db = new Database(DB_PATH);

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS assignment_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    part_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT NOT NULL,
    review_criteria TEXT NOT NULL,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
    UNIQUE(assignment_id, part_number)
  )
`);

// Database operations
export function getAllAssignments(): Assignment[] {
  return db.query("SELECT * FROM assignments ORDER BY id").all() as Assignment[];
}

export function getAssignmentWithParts(id: number): AssignmentWithParts | null {
  const assignment = db.query("SELECT * FROM assignments WHERE id = ?").get(id) as Assignment | null;
  if (!assignment) return null;

  const parts = db.query(
    "SELECT * FROM assignment_parts WHERE assignment_id = ? ORDER BY part_number"
  ).all(id) as AssignmentPart[];

  return { ...assignment, parts };
}

export function getAssignmentPart(partId: number): AssignmentPart | null {
  return db.query("SELECT * FROM assignment_parts WHERE id = ?").get(partId) as AssignmentPart | null;
}

export function getAllAssignmentParts(): (AssignmentPart & { assignment_name: string })[] {
  return db.query(`
    SELECT ap.*, a.name as assignment_name
    FROM assignment_parts ap
    JOIN assignments a ON ap.assignment_id = a.id
    ORDER BY a.id, ap.part_number
  `).all() as (AssignmentPart & { assignment_name: string })[];
}

export function createAssignment(name: string, description: string): number {
  const result = db.run(
    "INSERT INTO assignments (name, description) VALUES (?, ?)",
    [name, description]
  );
  return Number(result.lastInsertRowid);
}

export function createAssignmentPart(
  assignmentId: number,
  partNumber: number,
  title: string,
  description: string,
  requirements: string[],
  reviewCriteria: string
): number {
  const result = db.run(
    `INSERT INTO assignment_parts
     (assignment_id, part_number, title, description, requirements, review_criteria)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [assignmentId, partNumber, title, description, JSON.stringify(requirements), reviewCriteria]
  );
  return Number(result.lastInsertRowid);
}

export function deleteAssignment(id: number): boolean {
  const result = db.run("DELETE FROM assignments WHERE id = ?", [id]);
  return result.changes > 0;
}

export function clearDatabase() {
  db.run("DELETE FROM assignment_parts");
  db.run("DELETE FROM assignments");
  console.log("Database cleared");
}

export function seedDatabase(force = false) {
  // Check if we already have assignments
  const existing = db.query("SELECT COUNT(*) as count FROM assignments").get() as { count: number };
  if (existing.count > 0 && !force) {
    console.log("Database already seeded with assignments");
    return;
  }

  if (force) {
    clearDatabase();
  }

  console.log("Seeding database with CST-150 assignments...");

  // Create the main assignment
  const assignmentId = createAssignment(
    "CST-150 Activity 1",
    "Windows Forms Applications"
  );

  // Part 2: Name Display Application
  createAssignmentPart(
    assignmentId,
    2,
    "Name Display App",
    "Windows Forms app that displays your name in a label when a button is pressed.",
    [
      "Button triggers name display in a label",
      "Follow C# naming conventions (prefer CamelCase, avoid abbreviations)",
      "Code must be commented"
    ],
    `Review this C# WinForms project for the Name Display Application.

**Required Elements (not met is up to a 100% deduction):**
- Button that triggers name display
- Label that shows the name when button clicked
- Proper event handler implementation

**Naming Conventions (max 10% deduction, mark as warnings not errors):**
- Prefer CamelCase control names (e.g., ShowNameButton, DisplayNameLabel)
- Avoid abbreviations/Hungarian notation (e.g., "btn", "lbl", "txt")
- Full descriptive names preferred over abbreviated prefixes
- Variables: camelCase for local variables
- Note: Naming issues alone should not significantly impact the grade if functionality is correct

**Code Quality (max 20% deduction):**
- Comments explaining key logic
- Clean event handlers
- Proper form initialization

**Scoring:**
- Functionality is most important (70-80% of grade)
- Good naming is preferred but only minor deduction for abbreviations (max 10%)
- Comments and code quality matter but less than working functionality
- Default names (button1, label1) are worse than abbreviated names (btn, lbl)`
  );

  // Part 3: Weight Converter Application
  createAssignmentPart(
    assignmentId,
    3,
    "Mars Weight Converter",
    "Windows Forms app that converts Earth weight to Mars weight (×0.38), formatted to 2 decimal places.",
    [
      "TextBox for Earth weight input",
      "Button triggers conversion",
      "Label displays result formatted to 2 decimal places",
      "Follow naming conventions (prefer CamelCase, avoid abbreviations)",
      "Code must be commented"
    ],
    `Review this C# WinForms project for the Mars Weight Converter.

**Required Elements:**
- TextBox for Earth weight input
- Button to trigger conversion
- Label to display Mars weight result
- Result formatted to exactly 2 decimal places

**Computation:**
- Formula: Mars weight = Earth weight × 0.38
- Use double or decimal for weight variables
- Parse input string to numeric type

**Formatting:**
- Must use String.Format, ToString("F2"), or interpolation with :F2
- Example output: "Your weight on Mars is 76.00 pounds"

**Naming Conventions (max 10% deduction, mark as warnings not errors):**
- Prefer CamelCase control names (e.g., EarthWeightTextBox, ConvertButton, MarsWeightLabel)
- Avoid abbreviations/Hungarian notation (e.g., "txt", "btn", "lbl")
- Full descriptive names preferred over abbreviated prefixes
- Variables: camelCase for local variables
- Note: Naming issues alone should not significantly impact the grade if functionality is correct

**Bonus Considerations:**
- Input validation for non-numeric input
- Handling empty input
- Preventing negative values

**Scoring:**
- Functionality is most important (70-80% of grade): correct formula, proper formatting
- Good naming is preferred but only minor deduction for abbreviations (max 10%)
- Bonus for input validation, not required
- Default names (button1, label1) are worse than abbreviated names (btn, lbl)`
  );

  console.log("Database seeded successfully with CST-150 Activity 1 assignments");
}

// Export the database for advanced operations
export { db };
