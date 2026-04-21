#!/usr/bin/env node
import { Command } from "commander";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("drupal-cli")
    .description("Entity-agnostic CLI for Drupal 11 JSON:API")
    .version("0.0.0");
  return program;
}

export async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
