import { seedDatabase } from "./src/db";

console.log("Reseeding database with force=true...");
seedDatabase(true);
console.log("Database reseeded successfully!");
process.exit(0);

