import { readFile } from "node:fs/promises";
import { ValidationError } from "../errors.js";

export async function readDataArg(raw: string): Promise<unknown> {
  let text = raw;
  if (raw.startsWith("@")) {
    try { text = await readFile(raw.slice(1), "utf8"); }
    catch (err) { throw new ValidationError(`Cannot read --data file ${raw.slice(1)}: ${(err as Error).message}`); }
  }
  try { return JSON.parse(text); }
  catch (err) { throw new ValidationError(`--data is not valid JSON: ${(err as Error).message}`); }
}
